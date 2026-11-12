import { Cap } from './rpc.mjs';

// Every call names a workspace, including calls made before a chat exists.
// Resolve the client on each call: the desktop server can reconnect/restart.
export function createRunner(target) {
  const scoped = () => {
    const { client, location } = target();
    if (!location?.directory?.trim()) throw new Error('Choose a project folder first.');
    return { rpc: client.rpc(Cap), options: { location } };
  };
  return {
    execute: async (name, input) => {
      const { rpc, options } = scoped();
      return rpc.execute({ name, input }, options);
    },
    list: async (kind, overlay = {}) => {
      const { rpc, options } = scoped();
      return rpc.list({ kind, ...overlay }, options);
    },
  };
}
