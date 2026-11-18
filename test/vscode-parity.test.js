const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const commands = require('../commands');
const resources = require('../resources');

test('SDK, template and CLI versions match the VS Code 2.1.9 baseline', () => {
  const manifest = require('../package.json');
  assert.equal(manifest.dependencies['codeapp-js'], '2.4.0');
  assert.equal(manifest.dependencies['codeapp-js-cli'], '1.4.0');
  assert.equal(manifest.overrides['codeapp-js'], '$codeapp-js');
  assert.equal(require('codeapp-js/package.json').version, '2.4.0');
  assert.equal(require('codeapp-js-cli/package.json').version, '1.4.0');
  const cliRequire = require('node:module').createRequire(require.resolve('codeapp-js-cli'));
  assert.equal(cliRequire.resolve('codeapp-js/package.json'), require.resolve('codeapp-js/package.json'));
  const core = require('codeapp-js-cli');
  for (const name of ['capAuth', 'capDeploy', 'capDataverse', 'capConnector', 'capFlow', 'capImport', 'capEnvironment', 'createDataverseTable', 'createJsonEnvironmentVariable', 'listEnvironments', 'listPowerPlatformResources']) {
    assert.equal(typeof core[name], 'function', `${name} remains available in the installed CLI`);
  }
});

test('account change and logout use the CLI 1.4 two-argument auth API', async () => {
  const calls = [];
  const api = { capAuth: async (...args) => { calls.push(args); return { completed: true }; } };
  await commands.execute('change-account', { cloud: 'us' }, '/project', api);
  await commands.execute('sign-out', {}, '/project', api);
  assert.deepEqual(calls, [
    [[], { cwd: '/project', namedArgs: { cloud: 'us', change: true } }],
    [[], { cwd: '/project', namedArgs: { logout: true } }],
  ]);
});

test('deploy, import and flow keep explicit targets and non-interactive runner options', async () => {
  const calls = [];
  const api = Object.fromEntries(['capDeploy', 'capImport', 'capFlow', 'capConnector'].map((name) => [name, async (...args) => calls.push([name, ...args])]));
  await commands.execute('deploy', commands.argumentsFor('deploy', '--environment env --cloud us --solution-id sol'), '/project', api);
  await commands.execute('import', commands.argumentsFor('import', '"Inventory App" --environment env'), '/project', api);
  await commands.execute('add-flow', commands.argumentsFor('add-flow', 'flow-id --environment env'), '/project', api);
  await commands.execute('add-connector', { apiName: 'shared_sharepointonline', environment: 'env' }, '/project', api);
  assert.deepEqual(calls, [
    ['capDeploy', { cwd: '/project', debugger: false, passthroughArgs: ['--non-interactive', '--environment-id', 'env', '--cloud', 'us', '--solution-id', 'sol'] }],
    ['capImport', 'Inventory App', { cwd: '/project', namedArgs: { environment: 'env' } }],
    ['capFlow', 'flow-id', { cwd: '/project', preserveGeneratedArtifacts: true, passthroughArgs: ['--non-interactive', '--environment-id', 'env'] }],
    ['capConnector', 'shared_sharepointonline', { cwd: '/project', namedArgs: { environment: 'env' }, preserveGeneratedArtifacts: true }],
  ]);
  await assert.rejects(commands.execute('import', {}, '/project', api), /required/);
  await assert.rejects(commands.execute('add-flow', {}, '/project', api), /required/);
});

test('table metadata collected by VS Code is also passed by slash commands', async () => {
  let definition;
  const input = commands.argumentsFor('create-table', '--display-name Project --schema-name wd_Project --publisher-prefix wd --plural-name Projects --primary-display-name Title --ownership OrganizationOwned --description "Project tracking" --field "Status:choice:New|Active" --field "Account:lookup:account"');
  await commands.execute('create-table', input, '/project', { createDataverseTable: async (value) => { definition = value; } });
  assert.deepEqual(definition, {
    displayName: 'Project', schemaName: 'wd_Project', publisherPrefix: 'wd', pluralName: 'Projects', primaryDisplayName: 'Title', ownershipType: 'OrganizationOwned', description: 'Project tracking',
    fields: [{ displayName: 'Status', type: 'choice', options: 'New|Active' }, { displayName: 'Account', type: 'lookup', targetEntity: 'account' }],
  });
});

test('environment variables pass JSON and the selected environment to the CLI', async () => {
  const calls = [];
  const input = commands.argumentsFor('add-environment-variable', '--name "Service Settings" --publisher-prefix wd --value \'{"enabled":true}\' --environment env');
  await commands.execute('add-environment-variable', input, '/project', {
    createJsonEnvironmentVariable: async (...args) => calls.push(args),
  });
  assert.deepEqual(calls, [[
    { name: 'Service Settings', publisherPrefix: 'wd', value: '{"enabled":true}' },
    { cwd: '/project', environment: 'env' },
  ]]);
});

test('debugger toggles locally, round-trips CLI bootstrap, and never deploys', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-debugger-'));
  try {
    const indexPath = path.join(cwd, 'dist', 'index.js');
    await fs.mkdir(path.dirname(indexPath));
    const original = 'console.log("app");\n';
    await fs.writeFile(indexPath, original);
    const api = { capDeploy: () => assert.fail('Toggle must not deploy') };
    assert.deepEqual(await commands.execute('debugger', {}, cwd, api), { enabled: true, indexPath });
    assert.match(await fs.readFile(indexPath, 'utf8'), /^import \{ enableDebugger \}/);
    assert.deepEqual(await commands.execute('debugger', {}, cwd, api), { enabled: false, indexPath });
    assert.equal(await fs.readFile(indexPath, 'utf8'), original);
    await require('codeapp-js-cli').appendDebuggerBootstrap(cwd);
    assert.equal((await commands.execute('debugger', {}, cwd, api)).enabled, false);
    assert.equal(await fs.readFile(indexPath, 'utf8'), original);
    await fs.unlink(indexPath);
    await assert.rejects(commands.execute('debugger', {}, cwd, api), /index.js was not found/);
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

test('debugger honors custom build paths and nested configuration', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-debugger-path-'));
  try {
    await fs.mkdir(path.join(cwd, 'setup'));
    await fs.mkdir(path.join(cwd, 'build'));
    await fs.writeFile(path.join(cwd, 'setup', 'power.config.json'), JSON.stringify({ buildPath: '../build', buildEntryPoint: 'index.html' }));
    const indexPath = path.join(cwd, 'build', 'index.js');
    await fs.writeFile(indexPath, 'custom app');
    assert.deepEqual(await commands.execute('debugger', {}, cwd), { enabled: true, indexPath });
    await commands.execute('debugger', {}, cwd);
    assert.equal(await fs.readFile(indexPath, 'utf8'), 'custom app');
    await fs.writeFile(indexPath, "// custom placement\nimport { enableDebugger } from './codeapp.js';\nenableDebugger();\n");
    const custom = await fs.readFile(indexPath, 'utf8');
    await assert.rejects(commands.execute('debugger', {}, cwd), /remove it manually/);
    assert.equal(await fs.readFile(indexPath, 'utf8'), custom);
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

test('environment selection before setup never creates app configuration', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-environment-'));
  try {
    const calls = [];
    const api = { capEnvironment: async (...args) => { calls.push(args); return { name: 'env' }; } };
    assert.deepEqual(await commands.execute('change-environment', { target: 'env' }, cwd, api), { name: 'env', configUpdated: false });
    assert.deepEqual(await fs.readdir(cwd), []);
    assert.deepEqual(calls, []);
    await fs.mkdir(path.join(cwd, 'setup'));
    await fs.writeFile(path.join(cwd, 'setup', 'power.config.json'), '{}');
    assert.deepEqual(await commands.execute('change-environment', { target: 'env', cloud: 'us' }, cwd, api), { name: 'env' });
    assert.deepEqual(calls, [['env', { cwd, namedArgs: { cloud: 'us' } }]]);
    await assert.rejects(fs.access(path.join(cwd, 'power.config.json')));
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

test('setup applies selected environment, logo, metadata and escaped HTML title', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-setup-metadata-'));
  try {
    const result = await commands.execute('setup', commands.argumentsFor('setup', '--app-name "Projects & <Plans>" --description "Track work" --environment env --logo-path ./logo.png'), cwd);
    const config = JSON.parse(await fs.readFile(result.configPath, 'utf8'));
    assert.equal(config.environmentId, 'env');
    assert.equal(config.logoPath, './logo.png');
    assert.equal(config.description, 'Track work');
    const html = await fs.readFile(path.join(cwd, 'dist', 'index.html'), 'utf8');
    assert.match(html, /<title>Projects &amp; &lt;Plans&gt;<\/title>/);
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

test('bundled skills can be listed and read without installing or accepting arbitrary paths', async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-skills-'));
  try {
    const names = await commands.execute('skills', {}, cwd);
    assert.ok(names.includes('cap-cli'));
    const input = commands.argumentsFor('skills', 'cap-cli');
    const skill = await commands.execute('skills', input, cwd);
    assert.equal(skill.name, 'cap-cli');
    assert.equal(skill.content, await fs.readFile(path.join(path.dirname(require.resolve('codeapp-js/package.json')), 'AI', 'skills', 'cap-cli', 'SKILL.md'), 'utf8'));
    assert.deepEqual((await resources.list('skills', {}, cwd)).map((item) => item.value), names);
    await assert.rejects(commands.execute('skills', { skill: '../codeapp.agent.md' }, cwd), /Unknown bundled skill/);
    assert.deepEqual(await fs.readdir(cwd), []);
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});
