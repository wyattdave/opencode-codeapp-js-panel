import { Plugin } from '@opencode/plugin';
import commands from './commands.js';
import resources from './resources.js';
import { Cap } from './rpc.mjs';
import queue from './queue.js';
import workspace from './workspace.js';

const string = (description) => ({ type: 'string', description });
const fields = {
  environment: string('Power Platform environment ID or URL (optional override)'),
  cloud: string('Power Platform cloud/region'),
  table: string('Dataverse table logical name, e.g. account'),
  apiName: string('Connector API name, e.g. shared_sharepointonline'),
  flowId: string('Flow workflow ID'),
  name: string('Environment variable display name'),
  publisherPrefix: string('Dataverse publisher prefix'),
  value: string('JSON object value, serialized as a string'),
  displayName: string('Dataverse table display name'),
  pluralName: string('Dataverse table plural display name'),
  primaryDisplayName: string('Primary name column label'),
  app: string('Existing Code App name or app ID to import'),
  target: string('Environment ID or Dynamics URL to select'),
  solutionId: string('Solution ID for deployment'),
  appDisplayName: string('Name for the new Code App'),
  description: string('Description for the new Code App'),
  fields: { type: 'array', items: string('Column spec: Name:type[:details]'), description: 'Dataverse table columns' },
  skills: { type: 'boolean', description: 'Copy bundled Code App skills into .opencode/skills' },
  debugger: { type: 'boolean', description: 'Enable the debugger when deploying' },
};

const definitions = {
  'sign-in': ['Sign in to Power Apps without creating an app or sending a chat message', ['cloud']],
  deploy: ['Push the Code App to Power Platform', ['environment', 'cloud', 'solutionId', 'debugger']],
  debugger: ['Enable debugger bootstrap and deploy the Code App', ['environment', 'cloud', 'solutionId']],
  'add-dataverse': ['Add a Dataverse table data source', ['table', 'environment'], ['table']],
  'add-connector': ['Add a Power Platform connector', ['apiName', 'environment'], ['apiName']],
  'add-flow': ['Add an existing Power Automate flow by ID', ['flowId', 'environment'], ['flowId']],
  'add-environment-variable': ['Create a Dataverse JSON environment variable', ['name', 'publisherPrefix', 'value', 'environment'], ['name', 'publisherPrefix', 'value']],
  'create-table': ['Create a Dataverse table and optional columns', ['displayName', 'pluralName', 'primaryDisplayName', 'publisherPrefix', 'fields', 'environment'], ['displayName']],
  'list-mockups': ['List HTML mockups in agent/ without opening a browser', []],
  import: ['Import an existing Code App into the current workspace', ['app', 'environment'], ['app']],
  setup: ['Copy bundled codeapp-js template and install the Code App agent; optionally include skills', ['appDisplayName', 'description', 'skills']],
  'change-environment': ['List Power Platform environments or select one by ID or URL', ['target', 'cloud']],
};

export default Plugin.define({
  id: 'codeapp-js',
  async setup(ctx) {
    const cwd = ctx.location.directory;
    await ctx.rpc.register(Cap, {
      project: async () => workspace.inspectWorkspace(cwd),
      execute: async ({ name, input }) => queue.exclusive(async () => JSON.stringify(await commands.execute(name, input, cwd) ?? { completed: true }, null, 2)),
      list: async ({ kind, ...input }) => queue.exclusive(() => resources.list(kind, input, cwd)),
    });
    await ctx.command.transform((editor) => {
      for (const name of commands.names) {
        editor.add({
          name: `cap-${name}`,
          description: definitions[name][0],
          execute: async ({ sessionID, prompt }) => {
            const input = commands.argumentsFor(name, prompt.text);
            const result = await queue.exclusive(() => commands.execute(name, input, cwd));
            const text = result === undefined ? `CAP ${name} completed.` : JSON.stringify(result, null, 2);
            await ctx.session.synthetic({ sessionID, text });
          },
        });
      }
    });

    await ctx.tool.transform((editor) => {
      editor.namespace({ name: 'cap', description: 'Code App and Power Platform operations. Mutating tools change the selected environment or workspace.' });
      for (const name of commands.names) {
        const [description, properties, required] = definitions[name];
        editor.add({
          name: name.replaceAll('-', '_'),
          description,
          input: {
            type: 'object',
            properties: Object.fromEntries(properties.map((key) => [key, fields[key]])),
            required: required || [],
            additionalProperties: false,
          },
          options: { namespace: 'cap', codemode: true, permission: name === 'list-mockups' ? 'cap_read' : 'cap_mutation' },
          execute: async (input) => {
            const result = await queue.exclusive(() => commands.execute(name, input, cwd));
            return { content: JSON.stringify(result ?? { completed: true }, null, 2) };
          },
        });
      }
    });
  },
});
