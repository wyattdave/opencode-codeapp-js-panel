import { Cap } from './rpc.mjs';

export function sessionWorkspaceKey(session) {
  return `${session.key}\n${session.location?.directory || ''}`;
}

// Earlier plugin versions auto-opened tabs and persisted them on every project.
// Retire only our restored tabs after a positive, read-only non-Code-App check.
// Never close other plugins' panels or a tab explicitly opened during the check.
export async function pruneRestoredPanel(ctx, session, explicitlyOpened) {
  if (!session.location?.directory) return;
  const restored = ctx.layout.stored(session).filter((id) => id === 'panel' || id === 'controls');
  if (!restored.length || explicitlyOpened.has(sessionWorkspaceKey(session))) return;
  try {
    const project = await session.server.client.rpc(Cap).project({}, { location: session.location });
    if (project.isCodeApp !== false || explicitlyOpened.has(sessionWorkspaceKey(session))) return;
    for (const id of restored) ctx.layout.close(`${ctx.id}:${id}`, session);
  } catch {
    // Unreachable/older servers and filesystem errors are not proof that this
    // is an ordinary project. Leave the layout untouched in those cases.
  }
}
