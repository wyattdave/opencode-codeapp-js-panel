export type ResourceKind = 'environments' | 'tables' | 'connectors' | 'flows' | 'apps' | 'mockups';
export type Field = { key: string; label: string; type?: 'checkbox' | 'textarea' | 'fields'; resource?: ResourceKind; required?: boolean; placeholder?: string };
export type Operation = { name: string; label: string; group: string; description: string; action: string; fields: Field[] };
const text = (key: string, label: string, required = false, placeholder?: string): Field => ({ key, label, required, placeholder });
const pick = (key: string, label: string, resource: ResourceKind): Field => ({ key, label, resource, required: true });

export const operations: Operation[] = [
  { name: 'sign-in', label: 'Sign in to Power Apps', group: 'Getting started', description: 'Sign in using the Power Apps authentication flow. No chat, model request, or existing app configuration is required.', action: 'Sign in to Power Apps', fields: [] },
  { name: 'setup', label: 'Set up workspace', group: 'Workspace', description: 'Copy the app template and install the bundled codeapp agent as the project default. Existing app and agent files are preserved.', action: 'Set up workspace', fields: [text('appDisplayName', 'App name'), text('description', 'Description'), { key: 'skills', label: 'Include bundled skills', type: 'checkbox' }] },
  { name: 'import', label: 'Import app', group: 'Workspace', description: 'Import a solution into dist/ and update power.config.json. Existing app files may be replaced.', action: 'Import selected app', fields: [pick('app', 'Code App', 'apps')] },
  { name: 'list-mockups', label: 'Browse mockups', group: 'Workspace', description: 'Find HTML mockups in agent/. Choose a file to open in Review.', action: 'Refresh mockups', fields: [] },
  { name: 'change-environment', label: 'Change environment', group: 'Power Platform', description: 'Select an environment and save it to the workspace configuration.', action: 'Use selected environment', fields: [pick('target', 'Environment', 'environments')] },
  { name: 'deploy', label: 'Deploy app', group: 'Power Platform', description: 'Push the workspace app to Power Platform.', action: 'Deploy app', fields: [text('solutionId', 'Solution ID (optional)'), { key: 'debugger', label: 'Enable debugger', type: 'checkbox' }] },
  { name: 'debugger', label: 'Deploy with debugger', group: 'Power Platform', description: 'Add the debugger bootstrap to dist/index.js, then deploy the app.', action: 'Enable debugger & deploy', fields: [text('solutionId', 'Solution ID (optional)')] },
  { name: 'add-dataverse', label: 'Add Dataverse table', group: 'Data & automation', description: 'Generate a data source for an existing Dataverse table.', action: 'Add selected table', fields: [pick('table', 'Dataverse table', 'tables')] },
  { name: 'add-connector', label: 'Add connector', group: 'Data & automation', description: 'Generate a connector using its first available connection. Sign in or create a connection in Power Apps first.', action: 'Add selected connector', fields: [pick('apiName', 'Connector', 'connectors')] },
  { name: 'add-flow', label: 'Add flow', group: 'Data & automation', description: 'Generate a connector for an existing Power Automate flow.', action: 'Add selected flow', fields: [pick('flowId', 'Power Automate flow', 'flows')] },
  { name: 'add-environment-variable', label: 'Create environment variable', group: 'Data & automation', description: 'Create a JSON environment variable in Dataverse.', action: 'Create environment variable', fields: [text('name', 'Display name', true), text('publisherPrefix', 'Publisher prefix', true), { key: 'value', label: 'JSON object value', type: 'textarea', required: true, placeholder: '{"enabled": true}' }] },
  { name: 'create-table', label: 'Create Dataverse table', group: 'Data & automation', description: 'Create a Dataverse table and optional columns.', action: 'Create table', fields: [text('displayName', 'Display name', true), text('pluralName', 'Plural name'), text('primaryDisplayName', 'Primary name column'), text('publisherPrefix', 'Publisher prefix'), { key: 'fields', label: 'Columns (one per line)', type: 'fields', placeholder: 'Title:text\nStatus:choice:New|Active' }] },
];

export function formInput(values: Record<string, string | boolean>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === 'boolean' || value.trim() !== '')
    .map(([key, value]) => [key, key === 'fields' && typeof value === 'string' ? value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean) : value]));
}
