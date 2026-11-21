const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

async function harness(existing = {}) {
  const { Agent } = await import('@opencode/plugin');
  const agents = new Map(existing.agent ? [['codeapp', existing.agent]] : []);
  const skills = new Map(existing.skill ? [['codeapp', existing.skill]] : []);
  const commands = new Map();
  const transforms = {};
  const calls = [];
  const agentEditor = {
    get: (id) => agents.get(id),
    update: (id, update) => {
      const agent = agents.get(id) || Agent.Info.default(Agent.ID.make(id));
      update(agent);
      agents.set(id, agent);
    },
    default: () => assert.fail('Loading the plugin must not change the default agent'),
  };
  const skillEditor = { get: (id) => skills.get(id), add: (skill) => skills.set(skill.id, skill) };
  const ctx = {
    agent: { transform: async (fn) => { transforms.agent = fn; fn(agentEditor); } },
    skill: { transform: async (fn) => { transforms.skill = fn; fn(skillEditor); } },
    command: { transform: async (fn) => fn({ add: (command) => commands.set(command.name, command) }) },
    session: Object.fromEntries(['switchAgent', 'prompt', 'synthetic'].map((method) => [method, async (input) => calls.push([method, input])])),
  };
  return { ctx, agents, skills, commands, calls, replay: () => { transforms.agent(agentEditor); transforms.skill(skillEditor); } };
}

test('plugin loading registers the bundled agent and skill before workspace setup, without writing files', async () => {
  const { registerProfiles } = await import('../profiles.mjs');
  const { Agent, Skill } = await import('@opencode/plugin');
  const { Schema } = await import('effect');
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'cap-profiles-'));
  try {
    const host = await harness();
    await registerProfiles({ ...host.ctx, location: { directory: cwd } });
    const agent = host.agents.get('codeapp');
    const skill = host.skills.get('codeapp');
    assert.equal(agent.name, 'Code App');
    assert.equal(agent.mode, 'primary');
    assert.equal(agent.hidden, false);
    assert.equal(agent.model, undefined);
    assert.deepEqual(agent.permissions.at(-1), { action: 'cap_mutation', resource: '*', effect: 'ask' });
    assert.match(agent.system, /You are an expert AI coding agent specializing in Microsoft Power Platform CodeApps/);
    assert.doesNotMatch(agent.system, /argument-hint:|^---/);
    assert.ok(skill.content.endsWith(agent.system));
    assert.match(skill.content, /does not switch agents or models, grant permissions/);
    assert.match(skill.content, /ask for approval/);
    assert.ok((await fs.stat(skill.path)).isFile());
    Schema.decodeUnknownSync(Agent.Info)(agent);
    Schema.decodeUnknownSync(Skill.Info)(skill);
    assert.deepEqual(await fs.readdir(cwd), []);
    assert.deepEqual(host.calls, []);
    host.replay();
    assert.equal(host.agents.size, 1);
    assert.equal(host.skills.size, 1);
    assert.equal(agent.permissions.filter((rule) => rule.action === 'cap_mutation').length, 1);
  } finally { await fs.rm(cwd, { recursive: true, force: true }); }
});

test('user-defined agents and skills, including hidden or subagent-only profiles, are never overwritten', async () => {
  const { registerProfiles } = await import('../profiles.mjs');
  const agent = { id: 'codeapp', system: 'My custom instructions', model: { providerID: 'custom', id: 'model' }, mode: 'subagent', hidden: true, permissions: [] };
  const skill = { id: 'codeapp', content: 'My custom skill', autoinvoke: false };
  const host = await harness({ agent, skill });
  await registerProfiles(host.ctx);
  assert.equal(host.agents.get('codeapp'), agent);
  assert.equal(host.skills.get('codeapp'), skill);
  assert.deepEqual(agent.permissions, []);
  assert.equal(agent.hidden, true);
  assert.equal(agent.mode, 'subagent');
  assert.equal(skill.autoinvoke, false);
  host.replay();
  assert.equal(agent.system, 'My custom instructions');
});

test('/cap-agent switches only the current session and makes no model request without a task', async () => {
  const { registerProfiles } = await import('../profiles.mjs');
  const host = await harness();
  await registerProfiles(host.ctx);
  await host.commands.get('cap-agent').execute({ sessionID: 'current', prompt: { text: '' }, delivery: 'steer' });
  assert.deepEqual(host.calls, [
    ['switchAgent', { sessionID: 'current', agent: 'codeapp' }],
    ['synthetic', { sessionID: 'current', text: 'Code App agent selected. Your model is unchanged; send your task when ready.' }],
  ]);
});

test('/cap-agent forwards an explicit task, attachments and delivery after selecting the agent', async () => {
  const { registerProfiles } = await import('../profiles.mjs');
  const host = await harness();
  await registerProfiles(host.ctx);
  const prompt = { text: 'Build an inventory app', files: [{ uri: 'file:///requirements.md' }], skills: [{ id: 'codeapp' }] };
  await host.commands.get('cap-agent').execute({ sessionID: 'current', prompt, delivery: 'queue' });
  assert.deepEqual(host.calls, [
    ['switchAgent', { sessionID: 'current', agent: 'codeapp' }],
    ['prompt', { ...prompt, sessionID: 'current', delivery: 'queue' }],
  ]);
});

test('/cap-agent does not submit a prompt if switching agents fails', async () => {
  const { registerProfiles } = await import('../profiles.mjs');
  const host = await harness();
  host.ctx.session.switchAgent = async () => { throw new Error('Agent is disabled'); };
  await registerProfiles(host.ctx);
  await assert.rejects(host.commands.get('cap-agent').execute({ sessionID: 'current', prompt: { text: 'Build an app' } }), /Agent is disabled/);
  assert.deepEqual(host.calls, []);
});
