import {
  DEFAULT_RESOLVED_CONFIG,
  KNOWN_AGENT_NAMES,
  type AgentSettings,
  type AgentName,
  type ResolvedConfig,
} from "./types"
import { loadConfig } from "./loader"

/**
 * Resolve config for a single agent with the precedence:
 *   built-in defaults < repo JSONC < explicit command override
 *
 * The `repoConfig` is the parsed `agents` map from the JSONC file.
 * The `commandOverride` is an optional partial AgentSettings that wins over
 * everything else.
 */
export function resolveConfig(
  agentName: string,
  repoConfig?: Record<string, AgentSettings> | null,
  commandOverride?: Partial<AgentSettings> | null,
): ResolvedConfig {
  const agentSettings = repoConfig?.[agentName] ?? {}
  const merged: ResolvedConfig = {
    ...DEFAULT_RESOLVED_CONFIG,
    ...agentSettings,
    ...commandOverride,
  }
  return merged
}

/**
 * Dump resolved config for every known agent.
 * Useful for inspection, logging, and test assertions.
 */
export function dumpResolvedConfig(
  repoConfig?: Record<string, AgentSettings> | null,
  commandOverrides?: Record<string, Partial<AgentSettings>> | null,
): Record<string, ResolvedConfig> {
  const result: Record<string, ResolvedConfig> = {}
  for (const name of KNOWN_AGENT_NAMES) {
    result[name] = resolveConfig(name, repoConfig, commandOverrides?.[name])
  }
  return result
}

/**
 * Load a JSONC config file from its raw text and return resolved configs
 * for all known agents.  Convenience wrapper around loadConfig + dumpResolvedConfig.
 */
export function loadAndResolveAll(raw: string): Record<string, ResolvedConfig> {
  const root = loadConfig(raw)
  return dumpResolvedConfig(root.agents)
}
