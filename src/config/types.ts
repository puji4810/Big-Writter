import { z } from "zod"

export const KNOWN_AGENT_NAMES = [
  "creative-director",
  "idea-interviewer",
  "rough-outliner",
  "detailed-outliner",
  "writer",
  "corpus-analyst",
  "logic-world-motivation-reviewer",
  "prose-style-pacing-reviewer",
  "continuity-checker",
  "preference-boundary-checker",
] as const

export const AgentNameSchema = z.enum(KNOWN_AGENT_NAMES)

/**
 * Per-agent model/runtime settings.
 * All fields are optional at the config level; the resolver fills in defaults.
 */
export const AgentSettingsSchema = z
  .object({
    modelId: z.string().min(1, "modelId must not be empty").optional(),
    temperature: z
      .number()
      .min(0, "temperature must be >= 0")
      .max(2, "temperature must be <= 2")
      .optional(),
    maxOutputTokens: z
      .number()
      .int("maxOutputTokens must be an integer")
      .positive("maxOutputTokens must be positive")
      .optional(),
    timeoutMs: z
      .number()
      .int("timeoutMs must be an integer")
      .positive("timeoutMs must be positive")
      .optional(),
    reasoningMode: z
      .enum(["disabled", "enabled", "auto"])
      .optional(),
  })
  .strict()

/**
 * Root JSONC config shape.
 * Top-level unknown keys are rejected via .strict().
 */
export const RootConfigSchema = z
  .object({
    agents: z.partialRecord(AgentNameSchema, AgentSettingsSchema).optional(),
  })
  .strict()

export type AgentName = z.infer<typeof AgentNameSchema>
export type AgentSettings = z.infer<typeof AgentSettingsSchema>
export type RootConfig = z.infer<typeof RootConfigSchema>

/**
 * Fully resolved per-agent config after applying all precedence layers.
 */
export type ResolvedConfig = {
  modelId: string
  temperature: number
  maxOutputTokens: number
  timeoutMs: number
  reasoningMode: "disabled" | "enabled" | "auto"
}

/**
 * Built-in defaults used when no repo config or override provides a value.
 */
export const DEFAULT_RESOLVED_CONFIG: ResolvedConfig = {
  modelId: "claude-sonnet-4-20250514",
  temperature: 0.7,
  maxOutputTokens: 4096,
  timeoutMs: 120000,
  reasoningMode: "auto",
}
