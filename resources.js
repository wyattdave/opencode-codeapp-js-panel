const core = require('codeapp-js-cli');
const commands = require('./commands');

async function list(kind, input = {}, cwd = process.cwd(), api = core) {
  let records;
  switch (kind) {
    case 'environments':
      records = await api.listEnvironments({ cwd, region: input.cloud });
      return records.map((item) => ({ value: item.name, label: item.displayName || item.name, detail: item.dynamicsUrl || item.name }));
    case 'mockups':
      return (await commands.execute('list-mockups', {}, cwd, api)).map((file) => ({ value: file, label: file, detail: 'Workspace mockup' }));
    case 'skills':
      return (await commands.execute('skills', {}, cwd, api)).map((name) => ({ value: name, label: name, detail: 'Bundled codeapp-js skill' }));
    case 'tables': case 'connectors': case 'flows': case 'apps':
      records = await api.listPowerPlatformResources(kind, { cwd, environment: input.environment });
      break;
    default: throw new Error(`Unknown resource kind: ${kind}`);
  }
  return records.map((item) => {
    const value = kind === 'tables' ? item.LogicalName
      : kind === 'flows' ? item.workflowId
        : kind === 'connectors' ? item.name : item.id;
    const label = kind === 'tables' ? item.DisplayName?.UserLocalizedLabel?.Label || item.DisplayName?.LocalizedLabels?.[0]?.Label
      : item.displayName || item.name;
    return { value, label: label || value, detail: value };
  }).filter((item) => typeof item.value === 'string' && item.value.length > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

module.exports = { list };
