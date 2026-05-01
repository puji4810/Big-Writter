import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StageSchema, SCHEMA_VERSION, type RunState, type ReviewResult, type ActiveOutlinePointer } from "../../schemas"
import { initNovelProject, writeArtifact } from "../../storage"
import { createAllTools } from "../../tools"
import { createAllCommands, registerAllCommands } from ".."
import {
  handleNovelStart,
  handleNovelContinue,
  handleNovelWriteEvent,
  handleNovelStatus,
} from "../handlers"

let projectRoot: string

function ctx() {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "creative-director",
    directory: projectRoot,
    worktree: projectRoot,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: () => undefined,
  } as never
}

function parseToolOutput(result: unknown): Record<string, unknown> {
  if (typeof result === "string") {
    return JSON.parse(result) as Record<string, unknown>
  }
  return JSON.parse((result as { output: string }).output) as Record<string, unknown>
}

function makeRun(overrides: Partial<RunState> = {}): RunState {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: "run-1",
    projectId: "proj-1",
    stage: "interviewing",
    artifactIds: [],
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function makeActiveOutlinePointer(overrides: Partial<ActiveOutlinePointer> = {}): ActiveOutlinePointer {
  return {
    artifactId: "outline-art-1",
    markdownPath: "outlines/outline.md",
    markdownHash: "abc123",
    templateVersion: "1.0.0",
    compiledAt: new Date().toISOString(),
    syncStatus: "clean",
    ...overrides,
  }
}

function makeReview(overrides: Partial<ReviewResult> = {}): ReviewResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId: "review-1",
    runId: "run-1",
    createdAt: new Date().toISOString(),
    stage: "detailed_outline_review",
    sourceArtifactIds: [],
    status: "pass",
    gate: "logic-world-motivation",
    severity: "info",
    blockingIssues: [],
    nonBlockingSuggestions: [],
    affectedArtifactIds: [],
    artifactHash: "abc123",
    reason: "Looks good",
    suggestedFix: "No changes needed",
    requiresUserDecision: false,
    reviewedArtifactId: "outline-art-1",
    reviewedArtifactHash: "abc123",
    reviewedArtifactVersion: 1,
    deltas: [],
    reviewerId: "reviewer-1",
    ...overrides,
  } as ReviewResult
}

describe("novel commands", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-commands-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  // #given createAllCommands is called
  // #when the result is inspected
  // #then it contains exactly 5 command names in sorted order
  test("createAllCommands returns exactly five commands", () => {
    const commands = createAllCommands()

    expect(Object.keys(commands).sort()).toEqual([
      "novel-continue",
      "novel-ingest",
      "novel-start",
      "novel-status",
      "novel-write-event",
    ])
  })

  // #given createAllCommands returns command definitions
  // #when each definition is inspected
  // #then each has a template and description
  test("each command has template and description", () => {
    const commands = createAllCommands()

    for (const [name, cmd] of Object.entries(commands)) {
      expect(cmd.template).toBeDefined()
      expect(cmd.template.length).toBeGreaterThan(0)
      expect(cmd.description).toBeDefined()
      expect(cmd.description!.length).toBeGreaterThan(0)
    }
  })

  test("handler-backed commands are exported alongside templates", () => {
    const commands = createAllCommands()

    expect(commands["novel-start"].handler).toBe(handleNovelStart)
    expect(commands["novel-continue"].handler).toBe(handleNovelContinue)
    expect(commands["novel-write-event"].handler).toBe(handleNovelWriteEvent)
    expect(commands["novel-status"].handler).toBe(handleNovelStatus)
    expect(commands["novel-ingest"].handler).toBeUndefined()
  })

  // #given a config object with commands
  // #when registerAllCommands is called
  // #then all five commands are registered
  test("registerAllCommands adds five commands to config", () => {
    const config: Record<string, unknown> = {}

    registerAllCommands(config as never)

    expect(config.command).toBeDefined()
    const commands = config.command as Record<string, unknown>
    expect(Object.keys(commands).sort()).toEqual([
      "novel-continue",
      "novel-ingest",
      "novel-start",
      "novel-status",
      "novel-write-event",
    ])
    expect((commands["novel-start"] as { handler?: unknown }).handler).toBe(handleNovelStart)
    expect((commands["novel-status"] as { handler?: unknown }).handler).toBe(handleNovelStatus)
  })

  // #given registerAllCommands is called on a config that already has commands
  // #when commands are merged
  // #then existing commands are preserved and new ones added
  test("registerAllCommands merges with existing commands", () => {
    const config: Record<string, unknown> = {
      command: { "existing-cmd": { template: "existing" } },
    }

    registerAllCommands(config as never)

    const commands = config.command as Record<string, unknown>
    expect(commands["existing-cmd"]).toBeDefined()
    expect(commands["novel-start"]).toBeDefined()
  })

  // #given the novel-status command template
  // #when inspected
  // #then it contains instructions for uninitialized project handling
  test("novel-status template handles uninitialized projects", () => {
    const commands = createAllCommands()
    const template = commands["novel-status"].template

    expect(template).toContain("Project not initialized")
    expect(template).toContain("novel_project_status")
    expect(template).toContain("read-only")
  })

  // #given the novel-write-event command template
  // #when inspected
  // #then it contains mandatory gate check instructions that refuse before event_selection
  test("novel-write-event template enforces detailed outline gate", () => {
    const commands = createAllCommands()
    const template = commands["novel-write-event"].template

    expect(template).toContain("GATE CHECK")
    expect(template).toContain("event_selection")
    expect(template).toContain("REFUSE")
    expect(template).toContain("Cannot write event prose")
    expect(template).toContain("novel_project_status")
  })

  // #given the novel-continue command template
  // #when inspected
  // #then it contains stage-specific blocked gate reporting for every stage
  test("novel-continue template reports exact blocked gate per stage", () => {
    const commands = createAllCommands()
    const template = commands["novel-continue"].template

    // Must reference novel_project_status
    expect(template).toContain("novel_project_status")

    // Must reference all stage-named gates
    const stages = StageSchema.options
    for (const stage of stages) {
      expect(template).toContain(stage)
    }
  })

  // #given the novel-start command template
  // #when inspected
  // #then it routes to creative-director and covers initialization + interview
  test("novel-start template covers init and interview", () => {
    const commands = createAllCommands()
    const template = commands["novel-start"].template

    expect(template).toContain("novel_init_project")
    expect(template).toContain("IdeaInterviewer")
    expect(commands["novel-start"].agent).toBe("creative-director")
  })

  // #given the novel-ingest command template
  // #when inspected
  // #then it handles local source material through the ingest tool
  test("novel-ingest template handles corpus ingestion", () => {
    const commands = createAllCommands()
    const template = commands["novel-ingest"].template

    expect(template).toContain("novel_project_status")
    expect(template).toContain("novel_ingest_corpus")
    expect(template).toContain("abstract evidence packs")
    expect(commands["novel-ingest"].agent).toBe("creative-director")
  })

  // #given the plugin creates commands
  // #when the tool reports status before init
  // #then the tool returns initialized=false
  test("status before init returns not initialized via tool", async () => {
    const tools = createAllTools()

    const output = parseToolOutput(await tools.novel_project_status.execute({}, ctx()))

    expect(output.initialized).toBe(false)
    expect(output.nextAction).toBe("/novel-start or novel_init_project")
  })

  // #given a project in rough_outline_draft
  // #when advance_stage is called targeting event_selection directly
  // #then it is blocked because review gates are missing
  test("advancing to event_selection before detailed outline approval is blocked", async () => {
    const project = await initNovelProject(projectRoot)
    const tools = createAllTools()

    // Set stage to rough_outline_draft
    const now = new Date().toISOString()
    await writeArtifact("runs/current.json", {
      schemaVersion: "1.0.0",
      runId: "run-1",
      projectId: project.projectId,
      stage: "rough_outline_draft",
      artifactIds: [],
      updatedAt: now,
    }, projectRoot)

    try {
      await tools.novel_advance_stage.execute({ to: "event_selection" }, ctx())
      throw new Error("Expected transition failure")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      const novelError = error as { code?: string; message?: string }
      expect(novelError.code).toBe("ERR_STAGE_TRANSITION_BLOCKED")
    }
  })
})

describe("command handlers", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-handlers-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  // ── handleNovelStart ──

  // #given no project exists
  // #when handleNovelStart is called with null run
  // #then it returns action=init with guidance to initialize
  test("handleNovelStart returns init guidance when no project exists", async () => {
    const result = await handleNovelStart(null, projectRoot)

    expect(result.ok).toBe(false)
    expect(result.action).toBe("init")
    expect(result.guidance).toContain("No novel project found")
    expect(result.guidance).toContain("/novel-start")
  })

  // #given a project initialized at the interviewing stage
  // #when handleNovelStart is called
  // #then it reports the existing stage and suggests /novel-continue
  test("handleNovelStart returns continue when project already initialized", async () => {
    const run = makeRun({ stage: "interviewing" })

    const result = await handleNovelStart(run, projectRoot)

    expect(result.ok).toBe(true)
    expect(result.action).toBe("continue")
    expect(result.stage).toBe("interviewing")
    expect(result.guidance).toContain("already initialized")
    expect(result.guidance).toContain("/novel-continue")
  })

  // #given a project initialized but at uninitialized stage
  // #when handleNovelStart is called
  // #then it guides to start the interview
  test("handleNovelStart guides to interview when at uninitialized stage", async () => {
    const run = makeRun({ stage: "uninitialized" })

    const result = await handleNovelStart(run, projectRoot)

    expect(result.ok).toBe(true)
    expect(result.action).toBe("continue")
    expect(result.stage).toBe("uninitialized")
    expect(result.guidance).toContain("idea interview")
  })

  // #given a project with active rough outline pointer
  // #when handleNovelStart is called
  // #then it includes the active rough outline data
  test("handleNovelStart includes active outline pointers", async () => {
    const run = makeRun({
      stage: "rough_outline_review",
      activeRoughOutline: makeActiveOutlinePointer({ artifactId: "ro-1", syncStatus: "clean" }),
    })

    const result = await handleNovelStart(run, projectRoot)

    expect(result.activeRoughOutline).not.toBeNull()
    expect(result.activeRoughOutline?.artifactId).toBe("ro-1")
    expect(result.activeRoughOutline?.syncStatus).toBe("clean")
  })

  // ── handleNovelContinue ──

  // #given no project exists
  // #when handleNovelContinue is called
  // #then it returns init guidance
  test("handleNovelContinue returns init guidance when no project", async () => {
    const result = await handleNovelContinue(null, projectRoot)

    expect(result.ok).toBe(false)
    expect(result.action).toBe("init")
    expect(result.guidance).toContain("not initialized")
  })

  // #given a project at interviewing stage
  // #when handleNovelContinue is called
  // #then it reports pending gates
  test("handleNovelContinue reports pending gates at interviewing stage", async () => {
    await initNovelProject(projectRoot)
    const run = makeRun({ stage: "interviewing" })
    await writeArtifact("runs/current.json", run, projectRoot)

    const result = await handleNovelContinue(run, projectRoot)

    expect(result.ok).toBe(true)
    expect(result.stage).toBe("interviewing")
    expect(result.pendingGates).toContain("hasInterviewArtifact")
    expect(result.pendingGates).toContain("hasTargetAudience")
    expect(result.pendingGates).toContain("hasStoryObjective")
    expect(result.guidance).toContain("Current stage: interviewing")
  })

  // #given a project at uninitialized stage
  // #when handleNovelContinue is called
  // #then it reports uninitialized and suggests /novel-start
  test("handleNovelContinue at uninitialized stage reports actionable guidance", async () => {
    await initNovelProject(projectRoot)
    const run = makeRun({ stage: "uninitialized" })
    await writeArtifact("runs/current.json", run, projectRoot)

    const result = await handleNovelContinue(run, projectRoot)

    expect(result.ok).toBe(false)
    expect(result.action).toBe("init")
    expect(result.guidance).toContain("uninitialized")
    expect(result.guidance).toContain("/novel-start")
  })

  // #given a project with active rough outline and review data
  // #when handleNovelContinue is called at rough_outline_review stage
  // #then it includes review gate statuses and active outline pointers
  test("handleNovelContinue includes active outline and review gate statuses", async () => {
    await initNovelProject(projectRoot)
    const run = makeRun({
      stage: "rough_outline_review",
      activeRoughOutline: makeActiveOutlinePointer({ artifactId: "ro-1", syncStatus: "clean" }),
      artifactIds: ["review-lwm"],
    })
    await writeArtifact("runs/current.json", run, projectRoot)

    const review = makeReview({
      artifactId: "review-lwm",
      stage: "rough_outline_review",
      gate: "logic-world-motivation",
      reviewedArtifactId: "ro-1",
      reviewedArtifactHash: "abc123",
      artifactHash: "abc123",
    })
    await writeArtifact("reviews/review-lwm.json", review, projectRoot)

    const result = await handleNovelContinue(run, projectRoot)

    expect(result.activeRoughOutline).not.toBeNull()
    expect(result.activeRoughOutline?.artifactId).toBe("ro-1")
    expect(result.activeRoughOutline?.syncStatus).toBe("clean")
    expect(result.reviewGateStatuses).toBeDefined()
    expect(result.reviewGateStatuses!["logic-world-motivation"]).toBe("pass")
    expect(result.policyDecision).toBeDefined()
  })

  // #given a project with stale detailed outline markdown
  // #when handleNovelContinue is called
  // #then it reports stale sync status
  test("handleNovelContinue reports stale sync status", async () => {
    await initNovelProject(projectRoot)
    const run = makeRun({
      stage: "detailed_outline_review",
      activeDetailedOutline: makeActiveOutlinePointer({ artifactId: "do-1", syncStatus: "stale_markdown" }),
    })
    await writeArtifact("runs/current.json", run, projectRoot)

    const result = await handleNovelContinue(run, projectRoot)

    expect(result.activeDetailedOutline).not.toBeNull()
    expect(result.activeDetailedOutline?.syncStatus).toContain("stale")
  })

  // ── handleNovelWriteEvent ──

  // #given no project exists
  // #when handleNovelWriteEvent is called
  // #then it returns init guidance
  test("handleNovelWriteEvent returns init guidance when no project", async () => {
    const result = await handleNovelWriteEvent(null, projectRoot)

    expect(result.ok).toBe(false)
    expect(result.action).toBe("init")
  })

  // #given a project at interviewing stage without active detailed outline
  // #when handleNovelWriteEvent is called
  // #then it blocks prose because no active detailed outline exists
  test("handleNovelWriteEvent blocks prose without active detailed outline", async () => {
    const run = makeRun({ stage: "interviewing" })

    const result = await handleNovelWriteEvent(run, projectRoot)

    expect(result.ok).toBe(false)
    expect(result.action).toBe("block")
    expect(result.blockingReason).toContain("No active detailed outline found")
    expect(result.guidance).toContain("Cannot write event prose")
  })

  // #given a project at rough_outline_draft stage with an active detailed outline
  // #when handleNovelWriteEvent is called
  // #then it blocks because stage is before event_selection
  test("handleNovelWriteEvent blocks prose before event_selection stage", async () => {
    await initNovelProject(projectRoot)
    const run = makeRun({
      stage: "rough_outline_draft",
      activeDetailedOutline: makeActiveOutlinePointer({ artifactId: "do-1", syncStatus: "clean" }),
    })
    await writeArtifact("runs/current.json", run, projectRoot)

    const result = await handleNovelWriteEvent(run, projectRoot, "chapter-1")

    expect(result.ok).toBe(false)
    expect(result.action).toBe("block")
    expect(result.blockingReason).toContain("Detailed outline approval is required")
  })

  // #given a project at event_selection stage with approved detailed outline reviews
  // #when handleNovelWriteEvent is called
  // #then prose is allowed
  test("handleNovelWriteEvent allows prose at event_selection with approved outline", async () => {
    await initNovelProject(projectRoot)
    const run = makeRun({
      stage: "event_selection",
      activeDetailedOutline: makeActiveOutlinePointer({ artifactId: "do-1", syncStatus: "clean", markdownHash: "abc123" }),
      artifactIds: ["review-logic-world-motivation", "review-continuity", "review-preference-boundary"],
    })
    await writeArtifact("runs/current.json", run, projectRoot)

    const gates = ["logic-world-motivation", "continuity", "preference-boundary"] as const
    for (const gate of gates) {
      const review = makeReview({
        artifactId: `review-${gate}`,
        stage: "detailed_outline_review",
        gate,
        reviewedArtifactId: "do-1",
        reviewedArtifactHash: "abc123",
        artifactHash: "abc123",
      })
      await writeArtifact(`reviews/review-${gate}.json`, review, projectRoot)
    }

    const result = await handleNovelWriteEvent(run, projectRoot, "event-1")

    expect(result.ok).toBe(true)
    expect(result.action).toBe("continue")
    expect(result.guidance).toContain("Prose writing is allowed")
    expect(result.guidance).toContain("event-1")
  })

  // #given a project at event_selection stage but with stale markdown
  // #when handleNovelWriteEvent is called
  // #then it blocks with stale markdown message
  test("handleNovelWriteEvent blocks prose with stale detailed outline markdown", async () => {
    await initNovelProject(projectRoot)
    const run = makeRun({
      stage: "event_selection",
      activeDetailedOutline: makeActiveOutlinePointer({
        artifactId: "do-1",
        syncStatus: "stale_markdown",
        markdownHash: "abc123",
      }),
      artifactIds: [],
    })
    await writeArtifact("runs/current.json", run, projectRoot)

    const result = await handleNovelWriteEvent(run, projectRoot, "event-1")

    expect(result.ok).toBe(false)
    expect(result.action).toBe("block")
    expect(result.blockingReason).toContain("stale")
  })

  // ── handleNovelStatus ──

  // #given no project exists
  // #when handleNovelStatus is called
  // #then it returns init guidance
  test("handleNovelStatus returns init guidance when no project", async () => {
    const result = await handleNovelStatus(null, projectRoot)

    expect(result.ok).toBe(false)
    expect(result.action).toBe("init")
  })

  // #given a project at event_selection with active outline and prose pointers
  // #when handleNovelStatus is called
  // #then it reports all active artifacts and sync states
  test("handleNovelStatus reports active artifacts and sync states", async () => {
    await initNovelProject(projectRoot)
    const run = makeRun({
      stage: "event_selection",
      artifactIds: [],
      activeRoughOutline: makeActiveOutlinePointer({ artifactId: "ro-1", syncStatus: "clean" }),
      activeDetailedOutline: makeActiveOutlinePointer({ artifactId: "do-1", syncStatus: "clean" }),
      activeProseSelection: { artifactId: "draft-1", eventReference: "ch1-scene1" },
    })
    await writeArtifact("runs/current.json", run, projectRoot)

    const result = await handleNovelStatus(run, projectRoot)

    expect(result.ok).toBe(true)
    expect(result.action).toBe("report")
    expect(result.stage).toBe("event_selection")
    expect(result.activeRoughOutline?.artifactId).toBe("ro-1")
    expect(result.activeRoughOutline?.syncStatus).toBe("clean")
    expect(result.activeDetailedOutline?.artifactId).toBe("do-1")
    expect(result.activeDetailedOutline?.syncStatus).toBe("clean")
    expect(result.guidance).toContain("ro-1")
    expect(result.guidance).toContain("do-1")
    expect(result.guidance).toContain("draft-1")
    expect(result.guidance).toContain("ch1-scene1")
  })

  // #given a project with active character compilation pointer
  // #when handleNovelStatus is called
  // #then it reports character compilation info
  test("handleNovelStatus reports character compilation when present", async () => {
    await initNovelProject(projectRoot)
    const run = makeRun({
      stage: "detailed_outline_draft",
      artifactIds: [],
      activeCharacterCompilation: {
        markdownPath: "characters/index.md",
        compiledAt: new Date().toISOString(),
        fileCount: 5,
      },
    })
    await writeArtifact("runs/current.json", run, projectRoot)

    const result = await handleNovelStatus(run, projectRoot)

    expect(result.guidance).toContain("Character Compilation")
    expect(result.guidance).toContain("characters/index.md")
    expect(result.guidance).toContain("5")
  })

  // #given a project with review artifacts
  // #when handleNovelStatus is called
  // #then it reports review gate statuses
  test("handleNovelStatus reports review gate statuses", async () => {
    await initNovelProject(projectRoot)
    const run = makeRun({
      stage: "detailed_outline_review",
      artifactIds: ["review-lwm", "review-cont"],
      activeDetailedOutline: makeActiveOutlinePointer({ artifactId: "do-1", syncStatus: "clean", markdownHash: "abc123" }),
    })
    await writeArtifact("runs/current.json", run, projectRoot)

    await writeArtifact("reviews/review-lwm.json", makeReview({
      artifactId: "review-lwm",
      stage: "detailed_outline_review",
      gate: "logic-world-motivation",
      reviewedArtifactId: "do-1",
      reviewedArtifactHash: "abc123",
      artifactHash: "abc123",
    }), projectRoot)

    await writeArtifact("reviews/review-cont.json", makeReview({
      artifactId: "review-cont",
      stage: "detailed_outline_review",
      gate: "continuity",
      reviewedArtifactId: "do-1",
      reviewedArtifactHash: "abc123",
      artifactHash: "abc123",
    }), projectRoot)

    const result = await handleNovelStatus(run, projectRoot)

    expect(result.reviewGateStatuses).toBeDefined()
    expect(result.reviewGateStatuses!["logic-world-motivation"]).toBe("pass")
    expect(result.reviewGateStatuses!["continuity"]).toBe("pass")
    expect(result.guidance).toContain("PASS")
  })

  // #given a project with pending gates at interviewing stage
  // #when handleNovelStatus is called
  // #then it reports pending gates
  test("handleNovelStatus reports pending gates", async () => {
    await initNovelProject(projectRoot)
    const run = makeRun({ stage: "interviewing", artifactIds: [] })
    await writeArtifact("runs/current.json", run, projectRoot)

    const result = await handleNovelStatus(run, projectRoot)

    expect(result.pendingGates).toContain("hasInterviewArtifact")
    expect(result.pendingGates).toContain("hasTargetAudience")
    expect(result.pendingGates).toContain("hasStoryObjective")
    expect(result.guidance).toContain("Pending Gates")
  })
})
