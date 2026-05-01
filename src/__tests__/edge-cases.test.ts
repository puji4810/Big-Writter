import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCorpusAnalystAgent, createWriterAgent } from "../agents"
import { createAllCommands } from "../commands"
import { NovelError, NovelErrorCode } from "../errors"
import { RequiredProseReviewGates, SCHEMA_VERSION, computeArtifactHash, type ReviewGateName, type ReviewResult, type RunState } from "../schemas"
import { initNovelProject, writeArtifact } from "../storage"
import { createAllTools } from "../tools"

const createdAt = "2026-05-01T00:00:00.000Z"

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

function runState(projectId: string, stage: RunState["stage"]): RunState {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: "run-1",
    projectId,
    stage,
    artifactIds: [],
    updatedAt: createdAt,
  }
}

function review(gate: ReviewGateName, status: ReviewResult["status"], hash: string): ReviewResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId: `${gate}-${status}-review`,
    runId: "run-1",
    createdAt,
    stage: "prose_review",
    sourceArtifactIds: ["draft-1"],
    status,
    gate,
    severity: status === "pass" ? "info" : "blocking",
    blockingIssues: status === "pass" ? [] : [{ issue: "Boundary violation", suggestedFix: "Remove the hard-boundary content." }],
    nonBlockingSuggestions: [],
    affectedArtifactIds: ["draft-1"],
    artifactHash: hash,
    reason: status === "pass" ? "Passed." : "Hard boundary was violated.",
    suggestedFix: status === "pass" ? "No fix needed." : "Remove the hard-boundary content.",
    requiresUserDecision: false,
    reviewedArtifactId: "draft-1",
    reviewedArtifactHash: hash,
    reviewedArtifactVersion: 1,
    decision: status === "pass" ? "approved" : "revision_required",
    deltas: [],
    reviewerId: `${gate}-reviewer`,
  }
}

describe("workflow edge cases and safety hardening", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-edge-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("missing .novel status is handled gracefully", async () => {
    // #given
    const tools = createAllTools()

    // #when
    const output = parseToolOutput(await tools.novel_project_status.execute({}, ctx()))

    // #then
    expect(output.initialized).toBe(false)
    expect(output.nextAction).toBe("/novel-start or novel_init_project")
  })

  test("duplicate init is idempotent", async () => {
    // #given
    const tools = createAllTools()

    // #when
    const first = parseToolOutput(await tools.novel_init_project.execute({}, ctx()))
    const second = parseToolOutput(await tools.novel_init_project.execute({}, ctx()))

    // #then
    expect((second.project as { projectId: string }).projectId).toBe((first.project as { projectId: string }).projectId)
    expect((second.currentRun as RunState).runId).toBe((first.currentRun as RunState).runId)
  })

  test("corrupt JSON is reported as artifact corruption", async () => {
    // #given
    await initNovelProject(projectRoot)
    writeFileSync(join(projectRoot, ".novel", "project.json"), "{not-json")
    const tools = createAllTools()

    // #when / #then
    try {
      await tools.novel_read_artifact.execute({ artifact: { kind: "project" } }, ctx())
      throw new Error("Expected corrupt JSON failure")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.ARTIFACT_CORRUPT)
        expect(error.message).toContain("invalid JSON")
      }
    }
  })

  test("unsupported corpus files are rejected", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    await writeArtifact("runs/current.json", runState(project.projectId, "event_selection"), projectRoot)
    writeFileSync(join(projectRoot, "reference.epub"), "binary-ish")
    const tools = createAllTools()

    // #when / #then
    try {
      await tools.novel_ingest_corpus.execute({ files: ["reference.epub"] }, ctx())
      throw new Error("Expected unsupported corpus failure")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.UNSUPPORTED_CORPUS_FILE_TYPE)
      }
    }
  })

  test("stage skip from uninitialized to prose draft is blocked", async () => {
    // #given
    const tools = createAllTools()
    await tools.novel_init_project.execute({}, ctx())

    // #when / #then
    try {
      await tools.novel_advance_stage.execute({ to: "prose_draft" }, ctx())
      throw new Error("Expected stage skip failure")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.STAGE_TRANSITION_BLOCKED)
      }
    }
  })

  test("prose write before detailed outline gates is blocked", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    await writeArtifact("runs/current.json", runState(project.projectId, "interviewing"), projectRoot)
    const tools = createAllTools()

    // #when / #then
    try {
      await tools.novel_advance_stage.execute({ to: "prose_draft" }, ctx())
      throw new Error("Expected prose gate failure")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.STAGE_TRANSITION_BLOCKED)
      }
    }
  })

  test("whole-book prose requests are narrowed to event or bridge scope", () => {
    // #given / #when
    const template = createAllCommands()["novel-write-event"].template

    // #then
    expect(template).toContain("whole book")
    expect(template).toContain("narrow")
    expect(template).toContain("selected event or bridge")
  })

  test("direct author imitation is transformed or refused", () => {
    // #given / #when
    const writerPrompt = createWriterAgent().systemPrompt
    const corpusPrompt = createCorpusAnalystAgent().systemPrompt

    // #then
    expect(writerPrompt).toContain("MUST refuse direct requests to imitate")
    expect(writerPrompt).toContain("transform them into abstract traits")
    expect(corpusPrompt).toContain("You MUST NOT imitate a living author's exact expression")
  })

  test("boundary violation blocks draft readiness", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    const hash = computeArtifactHash("draft with blocked content")
    await writeArtifact("runs/current.json", runState(project.projectId, "prose_review"), projectRoot)
    const tools = createAllTools()
    const reviews = RequiredProseReviewGates.map((gate) => review(gate, gate === "preference-boundary" ? "fail" : "pass", hash))

    // #when / #then
    try {
      await tools.novel_advance_stage.execute({
        to: "draft_ready",
        gates: {
          reviewGate: { review: reviews[0], currentArtifactHash: hash },
          reviewGateSet: { reviews, currentArtifactHash: hash },
        },
      }, ctx())
      throw new Error("Expected boundary review failure")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.STAGE_TRANSITION_BLOCKED)
        expect(error.message).toContain("Boundary violation")
      }
    }
  })
})
