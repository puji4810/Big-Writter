import type { Config } from "@opencode-ai/plugin"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { ResolvedConfig } from "../config"
import { createContinuityCheckerAgent } from "./continuity-checker"
import { createCorpusAnalystAgent } from "./corpus-analyst"
import { createCreativeDirectorAgent } from "./creative-director"
import { createDetailedOutlinerAgent } from "./detailed-outliner"
import { createIdeaInterviewerAgent } from "./idea-interviewer"
import { createLogicWorldMotivationReviewerAgent } from "./logic-world-motivation-reviewer"
import { createPreferenceBoundaryCheckerAgent } from "./preference-boundary-checker"
import { createProseStylePacingReviewerAgent } from "./prose-style-pacing-reviewer"
import { createRoughOutlinerAgent } from "./rough-outliner"
import { createWriterAgent } from "./writer"
import type { NovelAgentConfig } from "./types"

export { createContinuityCheckerAgent } from "./continuity-checker"
export { createCorpusAnalystAgent } from "./corpus-analyst"
export { createCreativeDirectorAgent } from "./creative-director"
export { createDetailedOutlinerAgent } from "./detailed-outliner"
export { createIdeaInterviewerAgent } from "./idea-interviewer"
export { createLogicWorldMotivationReviewerAgent } from "./logic-world-motivation-reviewer"
export { createPreferenceBoundaryCheckerAgent } from "./preference-boundary-checker"
export { createProseStylePacingReviewerAgent } from "./prose-style-pacing-reviewer"
export { createRoughOutlinerAgent } from "./rough-outliner"
export { createWriterAgent } from "./writer"
export type { NovelAgentConfig, NovelAgentMode } from "./types"

export const agentFactories = [
  createCreativeDirectorAgent,
  createIdeaInterviewerAgent,
  createRoughOutlinerAgent,
  createDetailedOutlinerAgent,
  createLogicWorldMotivationReviewerAgent,
  createProseStylePacingReviewerAgent,
  createCorpusAnalystAgent,
  createWriterAgent,
  createContinuityCheckerAgent,
  createPreferenceBoundaryCheckerAgent,
] as const

export function createAllAgents(): NovelAgentConfig[] {
  return agentFactories.map((createAgent) => createAgent())
}

type RuntimeAgentConfig = AgentConfig & {
  model?: string
  temperature?: number
  maxOutputTokens?: number
  timeoutMs?: number
  reasoningMode?: ResolvedConfig["reasoningMode"]
}

export function registerAllAgents(config: Config, resolvedConfigs?: Record<string, ResolvedConfig>): void {
  config.agent ??= {}

  for (const agent of createAllAgents()) {
    config.agent[agent.name] = toOpenCodeAgentConfig(agent, resolvedConfigs?.[agent.name])
  }
}

function toOpenCodeAgentConfig(agent: NovelAgentConfig, resolvedConfig?: ResolvedConfig): AgentConfig {
  const runtimeConfig: RuntimeAgentConfig = {
    description: agent.description,
    prompt: agent.systemPrompt,
    mode: agent.mode,
    model: resolvedConfig?.modelId,
    temperature: resolvedConfig?.temperature,
    maxOutputTokens: resolvedConfig?.maxOutputTokens,
    timeoutMs: resolvedConfig?.timeoutMs,
    reasoningMode: resolvedConfig?.reasoningMode,
  }

  return runtimeConfig
}
