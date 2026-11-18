import { createEffect, createSignal, For, Show } from 'solid-js'
import type { MountedSession } from '@opencode/plugin/gui'
import { formInput, operations, type Operation, type ResourceKind } from './controls'
import { requiredInputsMet, runsFromButton } from './action-state'

type Item = { value: string; label: string; detail: string }
type Values = Record<string, string | boolean>
type Run = {
  execute(name: string, input: Record<string, unknown>): Promise<string>
  list(kind: ResourceKind, overlay?: { environment?: string }): Promise<Item[]>
}

function Spinner() { return <span class="cap-spinner" aria-hidden="true" /> }

// A list opens with its section. Refresh never selects an item or runs an action.
function ResourceList(props: { label: string; busy: boolean; load: () => Promise<Item[]>; choose: (value: string) => void; value?: string }) {
  const [items, setItems] = createSignal<Item[]>([])
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal('')
  const [search, setSearch] = createSignal('')
  let version = 0
  const refresh = async () => {
    const request = ++version
    setLoading(true); setError('')
    try { const result = await props.load(); if (request === version) setItems(result) }
    catch (caught) { if (request === version) setError(String(caught instanceof Error ? caught.message : caught)) }
    finally { if (request === version) setLoading(false) }
  }
  createEffect(() => { void refresh() })
  const matches = () => items().filter((item) => `${item.label} ${item.value} ${item.detail}`.toLowerCase().includes(search().toLowerCase()))
  return <div class="cap-resource-list" aria-busy={loading()}>
    <div class="cap-picker-heading"><strong>{props.label}</strong><button type="button" disabled={props.busy || loading()} onClick={() => void refresh()}>Refresh list</button></div>
    <Show when={loading()}><div class="cap-progress" role="status"><Spinner />Loading {props.label.toLowerCase()}…</div></Show>
    <Show when={error()}><div class="cap-error" role="alert">{error()}</div></Show>
    <input type="search" aria-label={`Search ${props.label}`} placeholder={`Search ${props.label.toLowerCase()}…`} value={search()} onInput={(event) => setSearch(event.currentTarget.value)} />
    <div class="cap-resource-options" role="group" aria-label={props.label}>
      <For each={matches()}>{(item) => <button type="button" disabled={props.busy || loading()} aria-pressed={props.value === item.value} onClick={() => props.choose(item.value)}>
        <span>{item.label}</span><small>{item.detail || item.value}</small>
      </button>}</For>
      <Show when={!loading() && !error() && !matches().length}><p class="cap-muted">No matches found.</p></Show>
    </div>
  </div>
}

export function FolderLink(props: { ctx: any; directory: string }) {
  const [error, setError] = createSignal('')
  return <><Show when={props.ctx.desktop}><button class="cap-folder-link" type="button" title={props.directory} onClick={async () => {
    setError('')
    try { await props.ctx.desktop.launch(props.directory) }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }}>Open folder in Explorer ↗</button></Show><Show when={error()}><p class="cap-error" role="alert">{error()}</p></Show></>
}

export function CodeAppPanel(props: { ctx: any; session?: MountedSession; directory: string; run: Run; onBusy?: (busy: boolean) => void }) {
  const prefs = () => props.ctx.stores.workspace.value
  const environment = () => prefs()?.environment || ''
  const [selected, setSelected] = createSignal<Operation>()
  const [values, setValues] = createSignal<Values>({})
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal('')
  const [error, setError] = createSignal('')
  const [result, setResult] = createSignal('')
  const set = (key: string, value: string | boolean) => setValues((current) => ({ ...current, [key]: value }))

  const execute = async (operation: Operation, input: Values) => {
    if (busy() || !requiredInputsMet(operation, input)) return
    setBusy(true); props.onBusy?.(true); setError(''); setResult(''); setMessage(`${operation.label}…`)
    try {
      // Mutation consent is still required; there is no duplicate action button.
      if (!['sign-in', 'skills'].includes(operation.name)) {
        if (!await props.ctx.dialogs.confirm({ title: operation.action, description: `${operation.description}\nWorkspace: ${props.directory}\nEnvironment: ${String(input.target || environment() || 'workspace configuration')}`, confirm: operation.action })) {
          setMessage('Cancelled — nothing was changed.'); return
        }
      }
      const output = await props.run.execute(operation.name, formInput({ ...(environment() ? { environment: environment() } : {}), ...input }))
      if (operation.name === 'change-environment' && typeof input.target === 'string') {
        props.ctx.stores.workspace.update((value: any) => { value.environment = input.target })
      }
      setResult(operation.name === 'skills' ? JSON.parse(output).content : output); setMessage(`${operation.label} completed.`)
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); setMessage('') }
    finally { setBusy(false); props.onBusy?.(false) }
  }
  const activate = (operation: Operation) => {
    if (busy()) return
    const input = selected()?.name === operation.name ? values() : {}
    if (selected()?.name !== operation.name) { setValues({}); setMessage(''); setError(''); setResult('') }
    setSelected(operation)
    if (operation.name === 'list-mockups') return
    if (runsFromButton(operation) || requiredInputsMet(operation, input)) void execute(operation, input)
  }
  const choose = (operation: Operation, key: string, value: string) => {
    const input = { ...values(), [key]: value }
    setValues(input)
    if (requiredInputsMet(operation, input)) void execute(operation, input)
  }
  const load = (kind: ResourceKind) => props.run.list(kind, kind === 'environments' ? {} : { environment: environment() || undefined })
  const openMockup = async (file: string) => {
    try {
      if (props.session) props.ctx.layout.open(`file:${file}`, props.session)
      else if (props.ctx.desktop) await props.ctx.desktop.launch(/^(?:[a-z]:[\\/]|\/|\\\\)/i.test(file) ? file : `${props.directory.replace(/[\\/]$/, '')}/${file}`)
      else throw new Error('Open a session to preview this mockup.')
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
  }

  return <div class="cap-panel" aria-busy={busy()}>
    <header class="cap-header"><div class="cap-eyebrow">CODE APP</div><h2>Workspace controls</h2><p>{props.directory}</p><FolderLink ctx={props.ctx} directory={props.directory} />
      <p class="cap-environment-label">Environment: {environment() || 'Workspace default'}</p>
    </header>
    <For each={['Getting started', 'Workspace', 'Power Platform', 'Data & automation']}>{(group) => <section class="cap-group">
      <h3>{group}</h3>
      <div class="cap-actions"><For each={operations.filter((operation) => operation.group === group)}>{(operation) => <button type="button" disabled={busy()} aria-pressed={selected()?.name === operation.name} onClick={() => activate(operation)}>
        {operation.label}<Show when={busy() && selected()?.name === operation.name} fallback={<span aria-hidden="true">↗</span>}><Spinner /></Show>
      </button>}</For></div>
      <Show when={selected()?.group === group ? selected() : undefined} keyed>{(operation) => <div class="cap-section-detail">
        <p class="cap-muted">{operation.description}</p>
        <Show when={operation.fields.some((field) => !field.resource)}>
          <form onSubmit={(event) => { event.preventDefault(); void execute(operation, values()) }}>
            <fieldset disabled={busy()}><For each={operation.fields.filter((field) => !field.resource)}>{(field) => <label class={field.type === 'checkbox' ? 'cap-checkbox' : ''}>
              <span>{field.label}{field.required ? ' *' : ''}</span>
              <Show when={field.type !== 'checkbox'} fallback={<input type="checkbox" checked={!!values()[field.key]} onChange={(event) => set(field.key, event.currentTarget.checked)} />}>
                <Show when={field.type === 'textarea' || field.type === 'fields'} fallback={<input value={String(values()[field.key] || '')} placeholder={field.placeholder} onInput={(event) => set(field.key, event.currentTarget.value)} />}>
                  <textarea rows={3} value={String(values()[field.key] || '')} placeholder={field.placeholder} onInput={(event) => set(field.key, event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void execute(operation, values()) } }} />
                </Show>
              </Show>
            </label>}</For></fieldset>
            <p class="cap-muted">{runsFromButton(operation) ? 'Optional settings for the next run. Click the action above to run again.' : 'Enter details, then press Enter or click the action above. In multiline fields, use Ctrl+Enter.'}</p>
          </form>
        </Show>
        <For each={operation.fields.filter((field) => field.resource)}>{(field) => <ResourceList label={field.label} busy={busy()} value={String(values()[field.key] || (field.resource === 'environments' ? environment() : ''))} load={() => load(field.resource!)} choose={(value) => choose(operation, field.key, value)} />}</For>
        <Show when={operation.name === 'list-mockups'}><ResourceList label="Mockups" busy={busy()} load={() => load('mockups')} choose={(file) => void openMockup(file)} /></Show>
        <Show when={message()}><div class="cap-progress" role="status" aria-live="polite"><Show when={busy()}><Spinner /></Show>{message()}</div></Show>
        <Show when={error()}><div class="cap-error" role="alert">{error()}</div></Show>
        <Show when={result()}><details class="cap-result" open={operation.name === 'skills'}><summary>Operation details</summary><pre>{result()}</pre></details></Show>
      </div>}</Show>
    </section>}</For>
  </div>
}
