const path = require('node:path');
const fs = require('node:fs/promises');
const core = require('codeapp-js-cli');
const { setupWorkspace } = require('./workspace');

const names = [
  'sign-in',
  'deploy', 'debugger', 'add-dataverse', 'add-connector', 'add-flow',
  'add-environment-variable', 'create-table', 'list-mockups', 'import',
  'setup', 'change-environment',
];

function words(text) {
  const result = [];
  const pattern = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'|(\S+)/g;
  for (const match of String(text || '').matchAll(pattern)) {
    result.push((match[1] ?? match[2] ?? match[3]).replace(/\\(["'\\])/g, '$1'));
  }
  return result;
}

function argumentsFor(name, text) {
  const args = words(text);
  const input = {};
  const valueFlags = {
    '--environment': 'environment', '--cloud': 'cloud', '--solution-id': 'solutionId',
    '--name': 'name', '--publisher-prefix': 'publisherPrefix', '--value': 'value',
    '--display-name': 'displayName', '--plural-name': 'pluralName',
    '--primary-display-name': 'primaryDisplayName', '--field': 'field',
    '--app-name': 'appDisplayName', '--description': 'description',
  };
  const positionals = [];
  for (let i = 0; i < args.length; i += 1) {
    const flag = valueFlags[args[i]];
    if (flag) {
      if (i + 1 >= args.length) throw new Error(`Missing value for ${args[i]}`);
      const value = args[++i];
      if (flag === 'field') (input.fields ??= []).push(value);
      else input[flag] = value;
    } else if (args[i] === '--skills') input.skills = true;
    else if (args[i] === '--debugger') input.debugger = true;
    else if (args[i].startsWith('-')) throw new Error(`Unknown option: ${args[i]}`);
    else positionals.push(args[i]);
  }
  if (positionals.length) {
    if (name === 'add-dataverse') input.table = positionals.join(' ');
    else if (name === 'add-connector') input.apiName = positionals.join(' ');
    else if (name === 'add-flow') input.flowId = positionals.join(' ');
    else if (name === 'import') input.app = positionals.join(' ');
    else if (name === 'change-environment') input.target = positionals.join(' ');
    else if (name === 'create-table') input.displayName ??= positionals.join(' ');
    else if (name !== 'list-mockups') throw new Error(`Unexpected argument: ${positionals.join(' ')}`);
  }
  return input;
}

function required(value, label) {
  if (!String(value || '').trim()) throw new Error(`${label} is required.`);
  return value;
}

function parseField(spec) {
  const [name, type = 'text', details = ''] = String(spec).split(':');
  if (!name.trim()) throw new Error(`Invalid field spec '${spec}'. Use Name:type[:details].`);
  const field = { displayName: name.trim(), type: type.trim() };
  if (/^(choice|choices|picklist|multiselect)$/i.test(type) && details) field.options = details.trim();
  else if (/^lookup$/i.test(type) && details) field.targetEntity = details.trim();
  else if (details) {
    for (const part of details.split(',')) {
      const [key, value] = part.trim().split('=');
      if (key) field[key] = value ?? true;
    }
  }
  return field;
}

async function listMockups(cwd) {
  const root = path.join(cwd, 'agent');
  const results = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile() && /\.html?$/i.test(entry.name)) results.push(path.relative(cwd, file).replace(/\\/g, '/'));
    }
  }
  try { await visit(root); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return results.sort();
}

async function execute(name, input = {}, cwd = process.cwd(), api = core) {
  const options = { cwd, namedArgs: { environment: input.environment } };
  switch (name) {
    case 'sign-in':
      return api.capAuth({ cwd, namedArgs: { cloud: input.cloud } });
    case 'deploy':
    case 'debugger': {
      const passthroughArgs = [];
      if (input.environment) passthroughArgs.push('--environment-id', input.environment);
      if (input.cloud) passthroughArgs.push('--cloud', input.cloud);
      if (input.solutionId) passthroughArgs.push('--solution-id', input.solutionId);
      return api.capDeploy({ cwd, debugger: name === 'debugger' || input.debugger === true, passthroughArgs });
    }
    case 'add-dataverse':
      return api.capDataverse(required(input.table, 'Table logical name'), { ...options, preserveGeneratedArtifacts: true });
    case 'add-connector':
      return api.capConnector(required(input.apiName, 'Connector API name'), { ...options, preserveGeneratedArtifacts: true });
    case 'add-flow':
      return api.capFlow(required(input.flowId, 'Flow ID'), {
        cwd, preserveGeneratedArtifacts: true,
        passthroughArgs: input.environment ? ['--environment-id', input.environment] : [],
      });
    case 'add-environment-variable':
      return api.createJsonEnvironmentVariable({
        name: required(input.name, 'Environment variable name'),
        publisherPrefix: required(input.publisherPrefix, 'Publisher prefix'),
        value: required(input.value, 'JSON object value'),
      }, { cwd, environment: input.environment });
    case 'create-table':
      return api.createDataverseTable({
        displayName: required(input.displayName, 'Table display name'),
        pluralName: input.pluralName,
        primaryDisplayName: input.primaryDisplayName,
        publisherPrefix: input.publisherPrefix,
        fields: input.fields?.map((field) => typeof field === 'string' ? parseField(field) : field),
      }, { cwd, environment: input.environment });
    case 'list-mockups':
      return listMockups(cwd);
    case 'import':
      return api.capImport(required(input.app, 'Code app name or ID'), options);
    case 'setup':
      return setupWorkspace({ cwd, skills: input.skills === true, appDisplayName: input.appDisplayName, description: input.description });
    case 'change-environment':
      if (!input.target) return api.listEnvironments({ cwd, region: input.cloud });
      return api.capEnvironment(input.target, { cwd, namedArgs: { cloud: input.cloud } });
    default:
      throw new Error(`Unknown CAP operation: ${name}`);
  }
}

module.exports = { names, words, argumentsFor, execute };
