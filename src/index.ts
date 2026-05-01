import type { Plugin } from "@opencode-ai/plugin";
import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { registerAllAgents } from "./agents"
import { registerAllCommands } from "./commands"
import { loadAndResolveAll } from "./config"
import { createAllTools } from "./tools"
import { registerAllHooks } from "./hooks"

const NovelClusterPlugin: Plugin = async (ctx) => {
  const hooks = registerAllHooks(ctx)

  return {
    ...hooks,
    tool: createAllTools(),
    config: async (config) => {
      const configPath = join(ctx.directory, "novel-cluster.config.jsonc")
      const resolvedConfigs = existsSync(configPath)
        ? loadAndResolveAll(readFileSync(configPath, "utf8"))
        : undefined

      registerAllAgents(config, resolvedConfigs)
      registerAllCommands(config)
    },
    "event": async () => {},
    "tool.execute.before": async () => {},
    "tool.execute.after": async () => {},
  };
};

export default NovelClusterPlugin;
