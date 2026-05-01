export type NovelAgentMode = "primary" | "subagent"

export type NovelAgentConfig = {
  name: string
  description: string
  systemPrompt: string
  mode: NovelAgentMode
}
