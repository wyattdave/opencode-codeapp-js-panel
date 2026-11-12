import { createEffect, createSignal, Show } from 'solid-js'
import { Schema } from 'effect'
import { Command, MenuItem, Panel, Plugin, SettingsPage, Slot, Store, Style } from '@opencode/plugin/gui'
import { createRunner } from '../runner.mjs'
import { pruneRestoredPanel, sessionWorkspaceKey } from '../restore.mjs'
import { CodeAppPanel } from './action-panel'
import css from './panel.css?inline'

export default Plugin.define({
  stores: {
    bar: Store.global(Schema.Struct({ hidden: Schema.Boolean }), { hidden: false }),
    workspace: Store.global(Schema.Struct({ folder: Schema.String, environment: Schema.String }), { folder: '', environment: '' }),
  },
  i18n: { en: { 'panel.title': 'Code App controls', 'menu.title': 'Code App', 'command.open': 'Open Code App controls' } },
  setup(ctx) {
    ctx.add(Style, css)
    const [drawerOpen, setDrawerOpen] = createSignal(false)
    const explicitlyOpened = new Set<string>()
    const checks = new Set<string>()
    createEffect(() => {
      const session = ctx.sessions.current()
      if (!session?.location || !ctx.layout.ready()) return
      const restored = ctx.layout.stored(session)
      const key = sessionWorkspaceKey(session)
      if (!restored.some((id) => id === 'panel' || id === 'controls') || checks.has(key)) return
      checks.add(key)
      void pruneRestoredPanel(ctx, session, explicitlyOpened)
    })
    const showBar = () => ctx.stores.bar.update((value) => { value.hidden = false })
    const hideBar = () => {
      setDrawerOpen(false)
      ctx.stores.bar.update((value) => { value.hidden = true })
    }
    createEffect(() => { ctx.router.path(); setDrawerOpen(false) })
    const openPanel = () => {
      const session = ctx.sessions.current()
      if (session) {
        explicitlyOpened.add(sessionWorkspaceKey(session))
        ctx.layout.open(`${ctx.id}:panel`, session)
      } else { showBar(); setDrawerOpen(true) }
    }
    ctx.add(Slot, {
      at: 'window.bottom',
      render: () => <Show when={!ctx.sessions.current() && ctx.stores.bar.value?.hidden === false}>
        <div class="cap-workspace-launcher"><strong>Code App</strong><span>Sign in and set up a project — no chat required.</span><button type="button" onClick={() => setDrawerOpen(!drawerOpen())}>{drawerOpen() ? 'Hide controls' : 'Open controls'}</button><button type="button" aria-label="Hide Code App bar" title="Restore with Show Code App bar in the command palette." onClick={hideBar}>Hide bar</button></div>
        <Show when={drawerOpen()}><aside class="cap-workspace-drawer" aria-label="Code App workspace controls">
          <div class="cap-drawer-heading"><strong>Code App workspace</strong><button type="button" aria-label="Close Code App controls" onClick={() => setDrawerOpen(false)}>Close</button></div>
          <WorkspaceControls ctx={ctx} />
        </aside></Show>
      </Show>,
    })
    ctx.add(Command, (): Command => ({ id: 'controls', title: ctx.t('command.open'), run: openPanel }))
    ctx.add(Command, (): Command => ({ id: 'show-bar', title: 'Show Code App bar', run: showBar }))
    ctx.add(MenuItem, (): MenuItem => {
      const current = ctx.sessions.current()
      return { menu: 'session.panel', id: 'panel', title: ctx.t('menu.title'), opened: !!current && ctx.layout.state(`${ctx.id}:panel`, current) !== 'closed', run: openPanel }
    })
    const tab = { id: 'panel', closable: 'compact' as const, fallback: true, get title() { return ctx.t('menu.title') } }
    ctx.add(Panel, {
      id: 'panel', region: 'side',
      list: (input) => (input.open.includes('panel') ? [tab] : []),
      render: (props) => <Show when={props.session} keyed>{(session) => <CodeAppPanel ctx={ctx} session={session} directory={session.directory} run={createRunner(() => ({ client: session.server.client, location: session.location }))} />}</Show>,
    })
    ctx.add(SettingsPage, {
      id: 'codeapp', get title() { return ctx.t('menu.title') },
      entries: [{ id: 'codeapp', title: 'Code App controls', keywords: 'cap power platform deploy dataverse environment mockups' }],
      render: () => <WorkspaceControls ctx={ctx} />,
    })
  },
})

// Restores the user's explicit last choice, never the service's cwd or a guessed
// draft folder. The selected path remains visible before any mutation.
function WorkspaceControls(props: { ctx: any }) {
  const target = () => props.ctx.stores.workspace.value?.folder || ''
  const [folder, setFolder] = createSignal(target())
  const [busy, setBusy] = createSignal(false)
  const [picking, setPicking] = createSignal(false)
  const [error, setError] = createSignal('')
  const selectFolder = (directory: string) => {
    setFolder(directory)
    props.ctx.stores.workspace.update((value: any) => { value.folder = directory })
    setError('')
  }
  const browse = async () => {
    if (busy() || picking()) return
    if (!props.ctx.desktop) { setError('The native folder picker requires OpenCode Desktop. Use manual entry below.'); return }
    setPicking(true); setError('')
    try {
      const [directory] = await props.ctx.desktop.pick({ directory: true, title: 'Choose the Code App project folder' })
      if (directory) selectFolder(directory)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setPicking(false) }
  }
  return <div class="cap-workspace-controls">
    <form class="cap-workspace-target" onSubmit={(event) => {
      event.preventDefault()
      const directory = folder().trim()
      if (!/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(directory)) { setError('Enter an absolute project folder path.'); return }
      selectFolder(directory)
    }}>
      <h2>Project folder</h2><p>Your last selection is remembered. Check the folder before running an action.</p>
      <fieldset disabled={busy() || picking()}>
        <button class="cap-folder-picker" type="button" aria-label="Choose Code App project folder" onClick={() => void browse()}><Show when={picking()}><span class="cap-spinner" aria-hidden="true" /> </Show>{picking() ? 'Opening folder picker…' : target() ? 'Change folder…' : 'Choose folder…'}</button>
        <p class="cap-selected-folder" role="status">{target() || 'No project folder selected'}</p>
        <details class="cap-manual-folder"><summary>Enter a path manually</summary>
          <label>Project folder<input aria-label="Code App project folder" value={folder()} placeholder="C:\\dev\\my-code-app" onInput={(event) => setFolder(event.currentTarget.value)} /></label>
          <div class="cap-workspace-target-actions"><button type="submit">Use folder</button></div>
        </details>
      </fieldset>
      <Show when={error()}><p class="cap-error" role="alert">{error()}</p></Show>
    </form>
    <Show when={target()} keyed>{(directory) => <CodeAppPanel ctx={props.ctx} directory={directory} onBusy={setBusy} run={createRunner(() => ({ client: props.ctx.client, location: { directory } }))} />}</Show>
  </div>
}
