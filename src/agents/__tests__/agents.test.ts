import { describe, expect, it } from "bun:test"
import type { Config } from "@opencode-ai/plugin"
import {
  createAllAgents,
  createContinuityCheckerAgent,
  createCorpusAnalystAgent,
  createCreativeDirectorAgent,
  createDetailedOutlinerAgent,
  createIdeaInterviewerAgent,
  createLogicWorldMotivationReviewerAgent,
  createPreferenceBoundaryCheckerAgent,
  createProseStylePacingReviewerAgent,
  createRoughOutlinerAgent,
  createWriterAgent,
  registerAllAgents,
} from ".."

const specialistFactories = [
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

describe("novel agents", () => {
  // #given all novel agent factories
  // #when all agents are created
  // #then exactly ten named agents are available
  it("creates all 10 agents", () => {
    const agents = createAllAgents()

    expect(agents).toHaveLength(10)
    expect(new Set(agents.map((agent) => agent.name)).size).toBe(10)
  })

  // #given the Creative Director factory
  // #when its agent is created
  // #then it is the only primary user-facing agent
  it("marks CreativeDirector as primary and specialists as subagents", () => {
    expect(createCreativeDirectorAgent().mode).toBe("primary")

    for (const createAgent of specialistFactories) {
      expect(createAgent().mode).toBe("subagent")
    }
  })

  // #given the plugin config hook receives a mutable config object
  // #when all agents are registered
  // #then each agent appears in config.agent with OpenCode prompt fields
  it("registers all agents into plugin config", () => {
    const config: Config = {}

    registerAllAgents(config)

    expect(Object.keys(config.agent ?? {})).toHaveLength(10)
    expect(config.agent?.["creative-director"]?.mode).toBe("primary")
    expect(config.agent?.["writer"]?.mode).toBe("subagent")
    expect(config.agent?.["writer"]?.prompt).toContain("You MUST NOT update canon. All output is draft only.")
  })

  // #given each specialist prompt has a narrow responsibility
  // #when prompt text is inspected
  // #then required responsibility and forbidden markers are present
  it("includes responsibility and forbidden markers in every prompt", () => {
    for (const agent of createAllAgents()) {
      expect(agent.systemPrompt).toContain("Responsib")
      expect(agent.systemPrompt).toMatch(/Forbidden|Operating rules/)
    }
  })

  // #given reviewer agents must not rewrite drafts
  // #when their prompt contracts are inspected
  // #then they only produce ReviewResult deltas
  it("limits reviewer prompts to ReviewResult deltas only", () => {
    const reviewers = [
      createLogicWorldMotivationReviewerAgent(),
      createProseStylePacingReviewerAgent(),
    ]

    for (const reviewer of reviewers) {
      expect(reviewer.systemPrompt).toContain("You produce ReviewResult deltas only. You MUST NOT rewrite prose.")
    }
  })

  // #given specialist boundaries protect stage ownership
  // #when key prompts are inspected
  // #then they prohibit out-of-scope work
  it("contains required specialist boundary text", () => {
    expect(createCreativeDirectorAgent().systemPrompt).toContain("You are the Creative Director for a Chinese web novel project")
    expect(createCreativeDirectorAgent().systemPrompt).toContain("ensure all four ReviewResult gates pass")
    expect(createCreativeDirectorAgent().systemPrompt).toContain("logic-world-motivation, prose-style-pacing, continuity, and preference-boundary")
    expect(createIdeaInterviewerAgent().systemPrompt).toContain("You MUST NOT write prose")
    expect(createIdeaInterviewerAgent().systemPrompt).toContain("You MUST NOT write outlines")
    expect(createRoughOutlinerAgent().systemPrompt).toContain("You MUST NOT write detailed chapters")
    expect(createDetailedOutlinerAgent().systemPrompt).toContain("You MUST NOT write prose")
    expect(createCorpusAnalystAgent().systemPrompt).toContain("You MUST NOT copy source passages")
    expect(createWriterAgent().systemPrompt).toContain("You MUST NOT update canon. All output is draft only.")
    expect(createContinuityCheckerAgent().systemPrompt).toContain("You MUST NOT rewrite prose")
    expect(createPreferenceBoundaryCheckerAgent().systemPrompt).toContain("You MUST NOT rewrite prose")
  })

  it("IdeaInterviewer prompt references novel_write_artifact for persistence", () => {
    const prompt = createIdeaInterviewerAgent().systemPrompt
    expect(prompt).toContain("novel_write_artifact")
    expect(prompt).toContain("interviewing")
    expect(prompt).toContain("questions")
    expect(prompt).toContain("summary")
    const warnedKeys = ["premise", "genre", "tone", "hardBoundaries"].filter(k => prompt.includes(k))
    expect(warnedKeys.length).toBeGreaterThanOrEqual(3)
  })

  it("CreativeDirector prompt mentions interview persistence and interviewing gates", () => {
    const prompt = createCreativeDirectorAgent().systemPrompt
    expect(prompt).toContain("novel_write_artifact")
    expect(prompt).toContain("hasInterviewArtifact")
    expect(prompt).toContain("hasTargetAudience")
    expect(prompt).toContain("hasStoryObjective")
  })

  it("Existing boundary assertions still pass", () => {
    expect(createCreativeDirectorAgent().systemPrompt).toContain("You are the Creative Director for a Chinese web novel project")
    expect(createCreativeDirectorAgent().systemPrompt).toContain("ensure all four ReviewResult gates pass")
    expect(createCreativeDirectorAgent().systemPrompt).toContain("logic-world-motivation, prose-style-pacing, continuity, and preference-boundary")
    expect(createIdeaInterviewerAgent().systemPrompt).toContain("You MUST NOT write prose")
    expect(createIdeaInterviewerAgent().systemPrompt).toContain("You MUST NOT write outlines")
    expect(createRoughOutlinerAgent().systemPrompt).toContain("You MUST NOT write detailed chapters")
    expect(createDetailedOutlinerAgent().systemPrompt).toContain("You MUST NOT write prose")
    expect(createCorpusAnalystAgent().systemPrompt).toContain("You MUST NOT copy source passages")
    expect(createWriterAgent().systemPrompt).toContain("You MUST NOT update canon. All output is draft only.")
    expect(createContinuityCheckerAgent().systemPrompt).toContain("You MUST NOT rewrite prose")
    expect(createPreferenceBoundaryCheckerAgent().systemPrompt).toContain("You MUST NOT rewrite prose")
  })
})
