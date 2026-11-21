const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const commands = require('../commands');
const { setupWorkspace } = require('../workspace');

test('all requested operations are registered and dispatch to Power Apps functions', async () => {
  const installed = new Map();
  const tools = new Map();
  const messages = [];
  let rpc;
  const { default: plugin } = await import('../index.mjs');
  await plugin.setup({
    location: { directory: 'test-project' },
    agent: { transform: async (fn) => fn({ get: () => undefined, update: (_id, update) => update({ permissions: [] }) }) },
    skill: { transform: async (fn) => fn({ get: () => undefined, add: () => {} }) },
    rpc: { register: async (definition, handlers) => { rpc = { definition, handlers }; } },
    command: { transform: async (fn) => fn({ add: (definition) => installed.set(definition.name, definition) }) },
    tool: { transform: async (fn) => fn({
      namespace: () => {},
      add: (definition) => tools.set(definition.name, definition),
    }) },
    session: { synthetic: async (message) => messages.push(message) },
  });
  for (const name of commands.names) {
    assert.ok(installed.has(`cap-${name}`));
    assert.ok(tools.has(name.replaceAll('-', '_')));
  }
  assert.equal(tools.get('add_dataverse').input.required[0], 'table');
  assert.equal(tools.get('setup').options.namespace, 'cap');
  assert.equal(tools.get('skills').options.permission, 'cap_read');
  assert.equal(tools.get('change_account').options.permission, 'cap_mutation');
  assert.equal(tools.get('sign_out').options.permission, 'cap_mutation');
  assert.deepEqual(tools.get('debugger').input.properties, {});
  assert.ok(tools.get('setup').input.properties.environment);
  assert.ok(tools.get('create_table').input.properties.schemaName);
  assert.deepEqual(tools.get('create_table').input.properties.ownershipType.enum, ['UserOwned', 'OrganizationOwned']);
  assert.deepEqual(rpc.definition.methods.execute.input.properties.name.enum.slice().sort(), commands.names.slice().sort());
  await installed.get('cap-list-mockups').execute({ sessionID: 'test', prompt: { text: '' } });
  assert.equal(messages[0].sessionID, 'test');
  assert.equal(rpc.definition.id, 'codeapp-js');
  assert.deepEqual(await rpc.handlers.list({ kind: 'mockups' }), []);
  assert.equal(await rpc.handlers.execute({ name: 'list-mockups', input: {} }), '[]');
  await assert.rejects(rpc.handlers.execute({ name: 'unknown', input: {} }), /Unknown CAP operation/);
});

test('slash arguments route environment, fields, and deployment debugger correctly', async () => {
  const calls = [];
  const fake = {
    capDeploy: async (input) => { calls.push(['deploy', input]); return { appId: '1' }; },
    capDataverse: async (...args) => { calls.push(['dataverse', ...args]); },
    createDataverseTable: async (...args) => { calls.push(['table', ...args]); },
    capEnvironment: async (...args) => { calls.push(['environment', ...args]); },
  };
  await commands.execute('deploy', commands.argumentsFor('deploy', '--debugger --environment env-1'), '/app', fake);
  await commands.execute('add-dataverse', commands.argumentsFor('add-dataverse', 'account --environment env-1'), '/app', fake);
  await commands.execute('create-table', commands.argumentsFor('create-table', '--display-name Project --field "Status:choice:New|Active"'), '/app', fake);
  assert.deepEqual(calls[0][1], { cwd: '/app', debugger: true, passthroughArgs: ['--non-interactive', '--environment-id', 'env-1'] });
  assert.equal(calls[1][1], 'account');
  assert.equal(calls[1][2].namedArgs.environment, 'env-1');
  assert.equal(calls[1][2].preserveGeneratedArtifacts, true);
  assert.deepEqual(calls[2][1].fields, [{ displayName: 'Status', type: 'choice', options: 'New|Active' }]);
  fake.listEnvironments = async () => [{ name: 'env-3' }];
  assert.deepEqual(await commands.execute('change-environment', {}, '/app', fake), [{ name: 'env-3' }]);
  assert.throws(() => commands.argumentsFor('deploy', '--unrecognized'), /Unknown option/);
});

test('setup retains existing OpenCode agent and optional skill, and bundles Code App runtime', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-opencode-'));
  try {
    const agentPath = path.join(cwd, '.opencode', 'agents', 'codeapp.md');
    const skillPath = path.join(cwd, '.opencode', 'skills', 'start', 'SKILL.md');
    await fs.mkdir(path.dirname(agentPath), { recursive: true });
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.writeFile(agentPath, 'my instructions');
    await fs.writeFile(skillPath, 'my skill');
    await fs.mkdir(path.join(cwd, 'dist'), { recursive: true });
    await fs.writeFile(path.join(cwd, 'dist', 'index.js'), 'my app');
    const result = await setupWorkspace({ cwd, appDisplayName: 'Test', skills: true });
    assert.equal(result.agentCreated, false);
    assert.equal(await fs.readFile(agentPath, 'utf8'), 'my instructions');
    assert.equal(await fs.readFile(skillPath, 'utf8'), 'my skill');
    assert.equal(await fs.readFile(path.join(cwd, 'dist', 'index.js'), 'utf8'), 'my app');
    assert.ok((await fs.stat(path.join(cwd, 'dist', 'codeapp.js'))).isFile());
    assert.equal(JSON.parse(await fs.readFile(path.join(cwd, 'power.config.json'), 'utf8')).appDisplayName, 'Test');
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('setup creates a V2 agent from the bundled instructions without enabling skills by default', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-opencode-agent-'));
  try {
    const result = await setupWorkspace({ cwd, appDisplayName: 'Example' });
    const agent = await fs.readFile(result.agentPath, 'utf8');
    assert.match(agent, /^---\ndescription:.*\nmode: primary\npermissions:/);
    assert.match(agent, /You are an expert AI coding agent specializing in Microsoft Power Platform CodeApps/);
    assert.match(agent, /action: cap_mutation/);
    assert.equal(result.defaultAgent, 'codeapp');
    assert.equal(JSON.parse(await fs.readFile(result.openCodeConfigPath, 'utf8')).default_agent, 'codeapp');
    assert.deepEqual(result.skills, []);
    await assert.rejects(fs.access(path.join(cwd, '.opencode', 'skills')));
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
});

test('setup sets the default agent while preserving JSONC comments and unrelated settings', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-opencode-config-'));
  try {
    const configPath = path.join(cwd, 'opencode.jsonc');
    await fs.writeFile(configPath, '{\n  // Keep this model\n  "model": "provider/model",\n  "plugins": ["custom-plugin"],\n  "default_agent": "build",\n}\n');
    const result = await setupWorkspace({ cwd });
    const content = await fs.readFile(configPath, 'utf8');
    assert.equal(result.openCodeConfigPath, configPath);
    assert.match(content, /\/\/ Keep this model/);
    const config = require('jsonc-parser').parse(content);
    assert.equal(config.default_agent, 'codeapp');
    assert.equal(config.model, 'provider/model');
    assert.deepEqual(config.plugins, ['custom-plugin']);
    await setupWorkspace({ cwd });
    assert.equal(await fs.readFile(configPath, 'utf8'), content);
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

test('setup updates a higher-precedence .opencode config, leaving root config intact', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-opencode-nested-'));
  try {
    await fs.mkdir(path.join(cwd, '.opencode'));
    await fs.writeFile(path.join(cwd, 'opencode.json'), '{"model":"keep"}');
    await fs.writeFile(path.join(cwd, '.opencode', 'opencode.json'), '{"default_agent":"build","commands":{}}');
    const result = await setupWorkspace({ cwd });
    assert.equal(result.openCodeConfigPath, path.join(cwd, '.opencode', 'opencode.json'));
    assert.equal(JSON.parse(await fs.readFile(result.openCodeConfigPath, 'utf8')).default_agent, 'codeapp');
    assert.equal(await fs.readFile(path.join(cwd, 'opencode.json'), 'utf8'), '{"model":"keep"}');
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

test('setup refuses to overwrite malformed OpenCode config', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-opencode-invalid-'));
  try {
    const configPath = path.join(cwd, 'opencode.jsonc');
    await fs.writeFile(configPath, '{broken');
    await assert.rejects(setupWorkspace({ cwd }), /invalid OpenCode config/);
    assert.equal(await fs.readFile(configPath, 'utf8'), '{broken');
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

test('resource lists normalize identifiers for searchable selectors without mutating resources', async () => {
  const resources = require('../resources');
  const calls = [];
  const api = {
    listEnvironments: async (options) => { calls.push(options); return [{ name: 'env-1', displayName: 'Development', dynamicsUrl: 'https://dev.crm.dynamics.com' }]; },
    listPowerPlatformResources: async (kind, options) => {
      calls.push([kind, options]);
      return {
        tables: [{ LogicalName: 'account', DisplayName: { UserLocalizedLabel: { Label: 'Account' } } }],
        connectors: [{ name: 'shared_sharepointonline', displayName: 'SharePoint' }],
        flows: [{ workflowId: 'flow-1', name: 'Approval' }],
        apps: [{ id: 'app-1', displayName: 'Inventory' }],
      }[kind];
    },
  };
  assert.deepEqual(await resources.list('environments', { cloud: 'us' }, '/app', api), [{ value: 'env-1', label: 'Development', detail: 'https://dev.crm.dynamics.com' }]);
  for (const [kind, value] of [['tables', 'account'], ['connectors', 'shared_sharepointonline'], ['flows', 'flow-1'], ['apps', 'app-1']]) {
    const options = await resources.list(kind, { environment: 'env-1' }, '/app', api);
    assert.equal(options[0].value, value);
    assert.deepEqual(calls.at(-1), [kind, { cwd: '/app', environment: 'env-1' }]);
  }
  await assert.rejects(resources.list('unknown', {}, '/app', api), /Unknown resource kind/);
});

test('plugin requests run serially and a failure does not block subsequent requests', async () => {
  const { exclusive } = require('../queue');
  const calls = [];
  let release;
  const first = exclusive(async () => {
    calls.push('first');
    await new Promise((resolve) => { release = resolve; });
    throw new Error('expected failure');
  });
  const failed = assert.rejects(first, /expected failure/);
  const second = exclusive(async () => { calls.push('second'); return 2; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ['first']);
  release();
  await failed;
  assert.equal(await second, 2);
  assert.deepEqual(calls, ['first', 'second']);
});

test('panel exposes every CAP operation and converts optional form fields correctly', async () => {
  const ts = require('typescript');
  const vm = require('node:vm');
  const source = await fs.readFile(path.join(__dirname, '..', 'src', 'controls.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } });
  const context = { exports: {} };
  vm.runInNewContext(compiled.outputText, context);
  const { operations, formInput } = context.exports;
  assert.deepEqual(Array.from(operations, (operation) => operation.name).sort(), [...commands.names].sort());
  const input = formInput({ displayName: 'Project', pluralName: '', fields: 'Title:text\n\nStatus:choice:New|Active\n', debugger: false });
  assert.deepEqual(JSON.parse(JSON.stringify(input)), { displayName: 'Project', fields: ['Title:text', 'Status:choice:New|Active'], debugger: false });
  for (const name of ['import', 'change-environment', 'add-flow', 'add-dataverse', 'add-connector']) {
    assert.ok(operations.find((operation) => operation.name === name).fields.some((field) => field.resource && field.required));
  }
  assert.ok(operations.find((operation) => operation.name === 'add-flow').fields.some((field) => field.key === 'flowId' && !field.resource));
  assert.ok(operations.find((operation) => operation.name === 'skills').fields.some((field) => field.resource === 'skills'));
});

test('pre-chat runner explicitly scopes every request and never creates or prompts a session', async () => {
  const { createRunner } = await import('../runner.mjs');
  const calls = [];
  const makeClient = (id) => ({ rpc: () => ({
    execute: async (input, options) => { calls.push({ id, input, options }); return 'done'; },
    list: async (input, options) => { calls.push({ id, input, options }); return []; },
  }) });
  let client = makeClient('first');
  const location = { directory: 'C:/dev/new-code-app' };
  const runner = createRunner(() => ({ client, location }));
  assert.equal(await runner.execute('sign-in', {}), 'done');
  assert.equal(await runner.execute('setup', { appDisplayName: 'Example' }), 'done');
  client = makeClient('reconnected');
  await runner.list('environments');
  assert.equal(calls.length, 3);
  for (const call of calls) assert.deepEqual(call.options, { location });
  assert.equal(calls[2].id, 'reconnected');
  const unset = createRunner(() => ({ client, location: undefined }));
  await assert.rejects(unset.execute('setup', {}), /Choose a project folder/);
  assert.equal(calls.length, 3);
});

test('sign-in uses authentication without requiring app configuration', async () => {
  const calls = [];
  const api = { capAuth: async (...args) => { calls.push(args); return { authenticated: true }; } };
  assert.deepEqual(await commands.execute('sign-in', { cloud: 'us' }, 'C:/dev/new-code-app', api), { authenticated: true });
  assert.deepEqual(calls, [[[], { cwd: 'C:/dev/new-code-app', namedArgs: { cloud: 'us' } }]]);
});

test('restored Code App tabs are pruned only in verified non-Code-App folders', async () => {
  const restore = await import('../restore.mjs');
  const layout = { storedRecords: new Map([['cap', ['panel']]]), opened: [], closed: [] };
  const session = { key: 'cap', location: { directory: 'C:/apps/real-code-app' } };
  let project = { isCodeApp: false };
  const calls = [];
  const sessionWithServer = { ...session, server: { client: { rpc: () => ({ project: async (input, options) => { calls.push({ input, options }); return project; } }) } } };
  const ctx = {
    id: 'codeapp-js',
    layout: {
      stored: (ref) => layout.storedRecords.get(ref.key) || [],
      close: (id, ref) => layout.closed.push([id, ref.key]),
    },
  };
  await restore.pruneRestoredPanel(ctx, sessionWithServer, new Set());
  assert.deepEqual(calls, [{ input: {}, options: { location: session.location } }], 'checks the server of the session, not the CLI checkout');
  assert.deepEqual(layout.closed, [['codeapp-js:panel', 'cap']], 'removes the stale tab in a non-Code-App project');
  layout.closed.length = 0;
  project = { isCodeApp: true };
  await restore.pruneRestoredPanel(ctx, sessionWithServer, new Set());
  assert.deepEqual(layout.closed, [], 'keeps the tab in a Code App project');
  project = { isCodeApp: false };
  await restore.pruneRestoredPanel(ctx, sessionWithServer, new Set(['cap\nC:/apps/real-code-app']));
  assert.deepEqual(layout.closed, [], 'never prunes a tab the user just opened');
  ctx.layout.stored = () => [];
  await restore.pruneRestoredPanel(ctx, sessionWithServer, new Set());
  assert.deepEqual(layout.closed, [], 'no restored ids means no work and no rpc');
  assert.equal(calls.length, 2);
  const failing = { ...session, server: { client: { rpc: () => ({ project: async () => { throw new Error('offline'); } }) } } };
  layout.storedRecords.set('cap', ['panel', 'controls']);
  await restore.pruneRestoredPanel(ctx, failing, new Set());
  assert.deepEqual(layout.closed, [], 'errors leave the layout untouched instead of guessing');
  const draftless = { key: 'draft' };
  await restore.pruneRestoredPanel(ctx, draftless, new Set());
  assert.deepEqual(layout.closed, [], 'drafts without a location are ignored');
});

test('workspace inspection detects bundled Code App config without touching other files', async () => {
  const workspace = require('../workspace.js');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-inspect-'));
  try {
    assert.deepEqual((await asyncInspect(workspace, temp)).isCodeApp, false, 'ordinary project');
    await fs.writeFile(path.join(temp, 'power.config.json'), '{}');
    assert.deepEqual((await asyncInspect(workspace, temp)).isCodeApp, true, 'root power.config.json');
    const nested = path.join(temp, 'setup');
    await fs.mkdir(nested);
    await fs.unlink(path.join(temp, 'power.config.json'));
    await fs.writeFile(path.join(nested, 'power.config.json'), '{}');
    assert.deepEqual((await asyncInspect(workspace, temp)).isCodeApp, true, 'setup/power.config.json');
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
});

async function asyncInspect(workspace, temp) {
  return workspace.inspectWorkspace(temp);
}

test('GUI registers an explicit pre-chat launcher and never auto-opens project panels', async () => {
  const ts = require('typescript');
  const vm = require('node:vm');
  const { createRunner } = await import('../runner.mjs');
  const restore = await import('../restore.mjs');
  const source = await fs.readFile(path.join(__dirname, '..', 'src', 'gui.tsx'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: 'jsx' } });
  const registry = Object.fromEntries(['Command', 'MenuItem', 'Panel', 'SettingsPage', 'Slot', 'Style', 'TitlebarItem'].map((key) => [key, key]));
  const effects = [];
  const solid = {
    createSignal: (initial) => { let value = initial; return [() => value, (next) => { value = typeof next === 'function' ? next(value) : next; }]; },
    createEffect: (effect) => { effects.push(effect); effect(); },
    Show: 'Show', For: 'For',
  };
  const context = {
    exports: {}, jsx: (type, props, ...children) => ({ type, props, children }),
    require: (name) => {
      if (name === 'solid-js') return solid;
      if (name === '@opencode/plugin/gui') return { ...registry, Plugin: { define: (definition) => definition }, Store: { global: (schema, initial) => ({ schema, initial }) } };
      if (name === 'effect') return { Schema: { Struct: (fields) => fields, Boolean: 'boolean' } };
      if (name === '../runner.mjs') return { createRunner };
      if (name === '../restore.mjs') return restore;
      if (name === './action-panel') return { CodeAppPanel: 'CodeAppPanel' };
      if (name === './controls') return {};
      if (name === './panel.css?inline') return { default: '' };
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  vm.runInNewContext(compiled.outputText, context);
  const entries = new Map();
  const registeredCommands = new Map();
  const preference = { value: { hidden: false }, update: (mutate) => mutate(preference.value) };
  const workspacePreference = { folder: '', environment: '' };
  let current;
  const opens = [];
  context.exports.default.setup({
    id: 'codeapp-js', add: (key, value) => {
      entries.set(key, value);
      if (key === 'Command') registeredCommands.set(value().id, value());
    }, t: (key) => key,
    stores: { bar: preference, workspace: { value: workspacePreference, update: (mutate) => mutate(workspacePreference) } },
    sessions: { current: () => current },
    router: { path: () => '/new-project-draft' },
    layout: { open: (...args) => opens.push(args) },
  });
  assert.equal(opens.length, 0);
  const slot = entries.get('Slot');
  assert.equal(slot.at, 'window.bottom');
  let tree = slot.render();
  assert.equal(tree.props.when, true, 'launcher is available without a session');
  const drawer = (node) => node.children.find((child) => child.type === 'Show');
  assert.equal(drawer(tree).props.when, false, 'drawer starts closed on unrelated projects');
  assert.equal(entries.has('TitlebarItem'), false, 'no Code App pill in the titlebar or tabs footer');
  registeredCommands.get('controls').run();
  tree = slot.render();
  assert.equal(drawer(tree).props.when, true, 'button opens workspace controls with no session');
  assert.equal(opens.length, 0, 'pre-chat controls do not need a session side panel');
  for (const effect of effects) effect();
  assert.equal(drawer(slot.render()).props.when, false, 'moving to a different project closes opt-in workspace controls');
  const hide = slot.render().children[0].children.find((child) => child.props?.['aria-label'] === 'Hide Code App bar');
  hide.props.onClick();
  assert.equal(preference.value.hidden, true);
  assert.equal(slot.render().props.when, false, 'hide removes the entire bar');
  for (const effect of effects) effect();
  assert.equal(slot.render().props.when, false, 'navigation does not restore a hidden bar');
  registeredCommands.get('show-bar').run();
  assert.equal(slot.render().props.when, true, 'show command restores the bar');
  assert.equal(drawer(slot.render()).props.when, false, 'restoring the bar does not force the drawer open');
  hide.props.onClick();
  registeredCommands.get('controls').run();
  assert.equal(preference.value.hidden, false, 'controls command provides another way back');
  assert.equal(drawer(slot.render()).props.when, true);
  current = { key: 'some-other-project' };
  assert.equal(slot.render().props.when, false);
  assert.equal(opens.length, 0, 'selecting another project does not open a panel');
  const settingsView = entries.get('SettingsPage').render();
  const picked = [];
  settingsView.props.ctx.desktop = { pick: async (options) => { picked.push(options); return ['C:/dev/picked-app']; } };
  const workspace = settingsView.type(settingsView.props);
  const descendants = (node) => !node || typeof node !== 'object' ? [] : [node, ...(node.children || []).flatMap(descendants)];
  const nodes = descendants(workspace);
  const chooseFolder = nodes.find((node) => node.props?.['aria-label'] === 'Choose Code App project folder');
  assert.ok(chooseFolder, 'native folder picker is the primary folder control');
  assert.equal(chooseFolder.props.type, 'button', 'folder selection does not submit or run setup');
  chooseFolder.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(picked.length, 1);
  assert.equal(picked[0].directory, true, 'opens a folder picker, not a file picker');
  assert.equal(workspacePreference.folder, 'C:/dev/picked-app', 'folder selection is persisted');
  const reopened = descendants(settingsView.type(settingsView.props));
  assert.equal(reopened.find((node) => node.props?.class === 'cap-selected-folder').children[0], 'C:/dev/picked-app', 'reopening restores the last selected folder');
  const manual = nodes.find((node) => node.type === 'details' && node.props?.class === 'cap-manual-folder');
  assert.ok(manual && !manual.props.open, 'manual input is collapsed by default');
});

test('section actions run directly, resource selections run once, and environment persists after success', async () => {
  const ts = require('typescript');
  const vm = require('node:vm');
  const compile = async (file, requireModule = () => { throw new Error('Unexpected import'); }, globals = {}) => {
    const source = await fs.readFile(path.join(__dirname, '..', 'src', file), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, jsxFactory: 'jsx', jsxFragmentFactory: 'Fragment' } });
    const context = { exports: {}, require: requireModule, Fragment: 'Fragment', ...globals };
    vm.runInNewContext(compiled.outputText, context);
    return context.exports;
  };
  const controls = await compile('controls.ts');
  const state = await compile('action-state.ts');
  assert.equal(state.runsFromButton(controls.operations.find((op) => op.name === 'setup')), true);
  assert.equal(state.runsFromButton(controls.operations.find((op) => op.name === 'import')), false);
  const signals = [];
  const effects = [];
  let cursor = 0;
  const solid = {
    Show: 'Show', For: 'For', createEffect: (effect) => effects.push(effect),
    createSignal: (initial) => {
      const index = cursor++;
      if (!(index in signals)) signals[index] = initial;
      return [() => signals[index], (next) => { signals[index] = typeof next === 'function' ? next(signals[index]) : next; }];
    },
  };
  const panel = await compile('action-panel.tsx', (name) => {
    if (name === 'solid-js') return solid;
    if (name === './controls') return controls;
    if (name === './action-state') return state;
    throw new Error(`Unexpected import: ${name}`);
  }, { jsx: (type, props, ...children) => ({ type, props: props || {}, children }) });
  const saved = { folder: 'C:/apps/example', environment: 'last-environment' };
  const calls = [];
  const confirmations = [];
  let approve = true;
  let fail = false;
  const props = {
    ctx: {
      stores: { workspace: { value: saved, update: (mutate) => mutate(saved) } },
      dialogs: { confirm: async (input) => { confirmations.push(input); return approve; } },
    },
    directory: saved.folder,
    run: { execute: async (name, input) => { calls.push({ name, input }); if (fail) throw new Error('request failed'); return name === 'skills' ? JSON.stringify({ name: input.skill, content: '# CLI instructions' }) : 'done'; }, list: async () => [] },
  };
  const flatten = (node) => {
    if (!node || typeof node !== 'object') return [];
    if (node.type === 'Show') {
      const children = node.props.when ? node.children.map((child) => typeof child === 'function' ? child(node.props.when) : child) : [node.props.fallback];
      return children.flatMap(flatten);
    }
    if (node.type === 'For') return (node.props.each || []).flatMap((item) => flatten(node.children[0](item)));
    return [node, ...node.children.flatMap(flatten)];
  };
  const render = () => { cursor = 0; return flatten(panel.CodeAppPanel(props)); };
  const action = (label) => render().find((node) => node.type === 'button' && node.children[0] === label);
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  action('Set up workspace').props.onClick();
  assert.equal(action('Set up workspace').props.disabled, true, 'action disables while awaiting consent/request');
  assert.ok(render().some((node) => node.props.role === 'status'), 'busy feedback is visible in the selected section');
  await settle();
  assert.equal(calls.length, 1, 'main button runs setup without another form submit');
  assert.equal(calls[0].input.environment, 'last-environment', 'restores environment from persisted preference');
  action('Import app').props.onClick();
  assert.equal(calls.length, 1, 'opening list does not mutate');
  const appList = render().find((node) => node.props.label === 'Code App');
  assert.ok(appList, 'app picker is inside the selected workspace section');
  appList.props.choose('app-id');
  await settle();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].input.app, 'app-id', 'selecting an app runs import without a second action button');
  action('Change environment').props.onClick();
  render().find((node) => node.props.label === 'Environment').props.choose('next-environment');
  await settle();
  assert.equal(saved.environment, 'next-environment');
  approve = false;
  render().find((node) => node.props.label === 'Environment').props.choose('cancelled-environment');
  await settle();
  assert.equal(saved.environment, 'next-environment', 'cancellation never replaces the saved environment');
  approve = true; fail = true;
  render().find((node) => node.props.label === 'Environment').props.choose('failed-environment');
  await settle();
  assert.equal(saved.environment, 'next-environment', 'failed changes never replace the saved environment');
  assert.ok(render().some((node) => node.props.role === 'alert' && node.children[0].includes('request failed')));
  assert.equal(action('Change environment').props.disabled, false, 'failure releases busy state');
  assert.ok(!render().some((node) => node.type === 'button' && node.props.type === 'submit'), 'no duplicate submit button below the sections');

  fail = false;
  const beforeSkill = confirmations.length;
  action('Browse skills').props.onClick();
  render().find((node) => node.props.label === 'Skill').props.choose('cap-cli');
  await settle();
  assert.equal(confirmations.length, beforeSkill, 'reading bundled skills is not a mutation');
  assert.equal(calls.at(-1).input.skill, 'cap-cli');
  assert.ok(render().some((node) => node.type === 'pre' && node.children[0] === '# CLI instructions'));
  assert.ok(render().some((node) => node.props.class === 'cap-result' && node.props.open));

  approve = false;
  const beforeLogout = calls.length;
  action('Log out').props.onClick();
  await settle();
  assert.equal(calls.length, beforeLogout, 'cancelled logout never clears authentication');
  approve = true;
  action('Change authentication account').props.onClick();
  await settle();
  assert.equal(calls.at(-1).name, 'change-account');

  action('Add flow').props.onClick();
  const manualFlow = render().find((node) => node.type === 'label' && flatten(node).some((child) => child.type === 'span' && child.children[0] === 'Flow ID (manual entry)'));
  flatten(manualFlow).find((node) => node.type === 'input').props.onInput({ currentTarget: { value: 'typed-flow-id' } });
  action('Add flow').props.onClick();
  await settle();
  assert.equal(calls.at(-1).name, 'add-flow');
  assert.equal(calls.at(-1).input.flowId, 'typed-flow-id', 'manual ID works without a list selection');
  action('Change environment').props.onClick();

  const resource = render().find((node) => node.props.label === 'Environment');
  const beforeRefresh = calls.length;
  let resolveLoad;
  let loads = 0;
  const listProps = { ...resource.props, load: () => { loads++; return new Promise((resolve) => { resolveLoad = resolve; }); } };
  signals.length = 0; effects.length = 0;
  const renderList = () => { cursor = 0; return flatten(resource.type(listProps)); };
  renderList();
  effects[0]();
  assert.ok(renderList().some((node) => node.props.role === 'status'), 'resource loading shows a progress indicator');
  resolveLoad([{ value: 'env-id', label: 'Environment name', detail: 'Details' }]);
  await settle();
  renderList().find((node) => node.type === 'button' && node.children[0] === 'Refresh list').props.onClick();
  assert.equal(loads, 2);
  assert.equal(calls.length, beforeRefresh, 'refreshing lists cannot execute an action');
  resolveLoad([]);
  await settle();

  signals.length = 0; cursor = 0;
  const opened = [];
  const link = flatten(panel.FolderLink({ ctx: { desktop: { launch: async (folder) => opened.push(folder) } }, directory: saved.folder }));
  await link.find((node) => node.type === 'button').props.onClick();
  assert.deepEqual(opened, [saved.folder], 'Explorer link opens exactly the displayed folder');
});
