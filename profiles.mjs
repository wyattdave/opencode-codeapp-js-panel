import { Agent, Skill } from '@opencode/plugin';
import workspace from './workspace.js';

export async function registerProfiles(ctx) {
  const { system, sourcePath } = await workspace.codeappInstructions();
  await ctx.agent.transform((editor) => {
    // Recheck on every replay: user profiles and later registrations take precedence.
    if (editor.get('codeapp')) return;
    editor.update('codeapp', (agent) => {
      agent.name = Agent.Name.make('Code App');
      agent.description = 'Build Microsoft Power Platform CodeApps using codeapp-js';
      agent.mode = 'primary';
      agent.hidden = false;
      agent.system = system;
      agent.permissions.push({ action: 'cap_mutation', resource: '*', effect: 'ask' });
    });
  });

  await ctx.skill.transform((editor) => {
    if (editor.get('codeapp')) return;
    editor.add({
      id: Skill.ID.make('codeapp'),
      name: Skill.Name.make('Code App'),
      description: 'Build or modify Microsoft Power Platform Code Apps with codeapp-js: HTML, JavaScript, Dataverse, connectors, flows and deployment. Use when the user requests the Code App workflow without switching agents.',
      path: Skill.Info.fields.path.make(sourcePath),
      content: `Apply the following Code App workflow to the user's current workspace. This skill does not switch agents or models, grant permissions, or initialize an app. Only run setup or other mutations when requested, and ask for approval before deploying or changing Power Platform resources. Use the cap_skills tool to read a matching bundled domain skill when needed.\n\n${system}`,
    });
  });

  await ctx.command.transform((editor) => {
    editor.add({
      name: 'cap-agent',
      description: 'Select the Code App agent for this session without changing its model; optionally send a task',
      execute: async ({ sessionID, prompt, delivery }) => {
        await ctx.session.switchAgent({ sessionID, agent: 'codeapp' });
        if (prompt.text.trim() || prompt.files?.length || prompt.skills?.length || prompt.agents?.length) {
          await ctx.session.prompt({ ...prompt, sessionID, delivery });
        } else {
          await ctx.session.synthetic({ sessionID, text: 'Code App agent selected. Your model is unchanged; send your task when ready.' });
        }
      },
    });
  });
}
