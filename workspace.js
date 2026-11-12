const fs = require('node:fs/promises');
const path = require('node:path');
const { parse, modify, applyEdits } = require('jsonc-parser');

async function setDefaultAgent(cwd) {
  // Prefer the .opencode config, which takes precedence over a root config.
  const candidates = ['.opencode/opencode.jsonc', '.opencode/opencode.json', 'opencode.jsonc', 'opencode.json'];
  let configPath = path.join(cwd, 'opencode.jsonc');
  for (const candidate of candidates) {
    if (await exists(path.join(cwd, candidate))) {
      configPath = path.join(cwd, candidate);
      break;
    }
  }
  const content = await exists(configPath) ? await fs.readFile(configPath, 'utf8') : '{}\n';
  const errors = [];
  const config = parse(content, errors, { allowTrailingComma: true });
  if (errors.length || !config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Cannot update invalid OpenCode config: ${configPath}`);
  }
  const formattingOptions = { insertSpaces: true, tabSize: 2, eol: content.includes('\r\n') ? '\r\n' : '\n' };
  let updated = content;
  if (!config.$schema) updated = applyEdits(updated, modify(updated, ['$schema'], 'https://opencode.ai/config.json', { formattingOptions }));
  updated = applyEdits(updated, modify(updated, ['default_agent'], 'codeapp', { formattingOptions }));
  if (updated !== content) await fs.writeFile(configPath, updated, 'utf8');
  return configPath;
}

function codeappRoot() {
  return path.dirname(require.resolve('codeapp-js/package.json'));
}

async function inspectWorkspace(cwd) {
  for (const name of ['power.config.json', 'setup/power.config.json']) {
    try {
      if ((await fs.stat(path.join(cwd, name))).isFile()) return { isCodeApp: true };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  return { isCodeApp: false };
}

async function ensureCodeappWorkspace(cwd, options = {}) {
  const root = codeappRoot();
  const agentPath = path.join(cwd, '.opencode', 'agents', 'codeapp.md');
  await fs.mkdir(path.dirname(agentPath), { recursive: true });

  const source = await fs.readFile(path.join(root, 'AI', 'codeapp.agent.md'), 'utf8');
  // OpenCode reads the Markdown body as the agent's system prompt; name and
  // argument-hint from the bundled format are not V2 agent frontmatter fields.
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
  const agent = `---\ndescription: Build Microsoft Power Platform CodeApps with the bundled codeapp-js instructions\nmode: primary\npermissions:\n  - action: cap_mutation\n    resource: "*"\n    effect: ask\n---\n\n${body}`;
  // Never replace a user's customized agent.
  const agentCreated = await copyIfAbsentFromContent(agent, agentPath);

  const skills = [];
  if (options.skills) {
    const sourceSkills = path.join(root, 'AI', 'skills');
    const targetSkills = path.join(cwd, '.opencode', 'skills');
    await fs.mkdir(targetSkills, { recursive: true });
    for (const entry of await fs.readdir(sourceSkills, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sourceSkill = path.join(sourceSkills, entry.name);
      const targetSkill = path.join(targetSkills, entry.name);
      // Copy only missing skills; existing instructions and supporting files belong to the user.
      try {
        await fs.cp(sourceSkill, targetSkill, { recursive: true, force: false, errorOnExist: true });
        skills.push(entry.name);
      } catch (error) {
        if (error.code !== 'ERR_FS_CP_EEXIST' && error.code !== 'EEXIST') throw error;
      }
    }
  }
  const openCodeConfigPath = await setDefaultAgent(cwd);
  return { agentPath, agentCreated, skills, openCodeConfigPath, defaultAgent: 'codeapp' };
}

async function setupWorkspace(options = {}) {
  const cwd = path.resolve(options.cwd || process.cwd());
  const template = path.join(codeappRoot(), 'codeApp');
  await fs.mkdir(cwd, { recursive: true });
  for (const entry of await fs.readdir(template)) {
    await fs.cp(path.join(template, entry), path.join(cwd, entry), { recursive: true, force: false });
  }

  const workspace = await ensureCodeappWorkspace(cwd, options);
  const primaryConfig = path.join(cwd, 'power.config.json');
  const secondaryConfig = path.join(cwd, 'setup', 'power.config.json');
  const configPath = await exists(primaryConfig) ? primaryConfig : secondaryConfig;
  const current = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const updated = {
    ...current,
    appDisplayName: options.appDisplayName || current.appDisplayName || '',
    description: options.description || current.description || '',
  };
  await fs.writeFile(configPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
  return {
    destination: cwd,
    configPath,
    appDisplayName: updated.appDisplayName,
    description: updated.description,
    ...workspace,
  };
}

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

async function copyIfAbsentFromContent(content, destination) {
  try {
    await fs.writeFile(destination, content, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}

module.exports = { ensureCodeappWorkspace, setupWorkspace, inspectWorkspace };
