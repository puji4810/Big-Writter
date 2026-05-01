import type { Plugin } from "@opencode-ai/plugin";
import { registerAllAgents } from "./agents"
import { registerAllCommands } from "./commands"
import { createAllTools } from "./tools"
import { registerAllHooks } from "./hooks"

const NovelClusterPlugin: Plugin = async (ctx) => {
  const hooks = registerAllHooks(ctx)

  return {
    ...hooks,
    tool: createAllTools(),
    config: async (config) => {
      registerAllAgents(config)
      registerAllCommands(config)
    },
    "event": async () => {},
    "tool.execute.before": async () => {},
    "tool.execute.after": async () => {},
  };
};

export default NovelClusterPlugin;
