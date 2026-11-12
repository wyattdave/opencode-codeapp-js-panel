// The Power Apps runtime has process-wide cwd and player-service state. Keep
// requests from panels, tools and slash commands from crossing workspaces.
let pending = Promise.resolve();
function exclusive(action) {
  const result = pending.then(action);
  pending = result.catch(() => {});
  return result;
}
module.exports = { exclusive };
