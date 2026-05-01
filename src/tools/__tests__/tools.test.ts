import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { NovelError, NovelErrorCode } from "../../errors"
import { ReviewResultSchema, SCHEMA_VERSION, computeArtifactHash, type CanonFactSet, type ReviewResult, type RunState } from "../../schemas"
import { initNovelProject, readArtifact, writeArtifact } from "../../storage"
import { createAllTools } from ".."

const createdAt = "2026-05-01T00:00:00.000Z"
const longSourceSentence = "This deliberately singular training sentence describes a silver observatory, seven rain-marked contracts, and a courier who counts thunder between impossible appointments so that leakage tests can identify whether source prose was copied into evidence output."

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

function runState(stage: RunState["stage"]): RunState {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: "run-1",
    projectId: "project-1",
    stage,
    artifactIds: [],
    updatedAt: createdAt,
  }
}

function approvedReview(hash: string): ReviewResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId: "review-1",
    runId: "run-1",
    createdAt,
    stage: "prose_review",
    sourceArtifactIds: ["draft-1"],
    status: "pass",
    gate: "logic-world-motivation",
    severity: "info",
    blockingIssues: [],
    nonBlockingSuggestions: [],
    affectedArtifactIds: ["draft-1"],
    artifactHash: hash,
    reason: "Draft passes review.",
    suggestedFix: "No fix needed.",
    requiresUserDecision: false,
    reviewedArtifactId: "draft-1",
    reviewedArtifactHash: hash,
    reviewedArtifactVersion: 1,
    decision: "approved",
    deltas: [],
    reviewerId: "reviewer-1",
  }
}

function canonFactSet(hash: string): CanonFactSet {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId: "canon-1",
    runId: "run-1",
    createdAt,
    stage: "canon_accepted",
    sourceArtifactIds: ["draft-1"],
    status: "accepted",
    acceptedArtifactHash: hash,
    facts: [{ factId: "fact-1", subject: "city", predicate: "remembers", object: "promises", evidenceArtifactIds: ["draft-1"] }],
  }
}

describe("novel tools", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-tools-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("registers all domain tools", () => {
    // #given / #when
    const tools = createAllTools()

    // #then
    expect(Object.keys(tools).sort()).toEqual([
      "novel_accept_canon",
      "novel_advance_stage",
      "novel_archive_run",
      "novel_check_boundaries",
      "novel_ingest_corpus",
      "novel_init_project",
      "novel_project_status",
      "novel_read_artifact",
      "novel_record_review",
      "novel_select_evidence",
      "novel_write_artifact",
    ])
  })


  test("ingests authorized markdown into validating abstract evidence pack without source prose", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    await writeArtifact("runs/current.json", { ...runState("event_selection"), projectId: project.projectId }, projectRoot)
    const fixturePath = join(dirname(new URL(import.meta.url).pathname), "fixtures/corpus/sample-authorized.md")
    const localPath = join(projectRoot, "sample-authorized.md")
    copyFileSync(fixturePath, localPath)
    const tools = createAllTools()

    // #when
    const output = parseToolOutput(await tools.novel_ingest_corpus.execute({ files: ["sample-authorized.md"], authorizationNote: "authorized local sample" }, ctx()))

    // #then
    expect(output.ingested).toBe(1)
    const result = (output.results as Array<Record<string, string>>)[0]
    expect(result.status).toBe("ingested")
    const evidence = await readArtifact(`corpus/evidence-packs/${result.evidencePackId}.json`, projectRoot) as { abstractEvidence?: Array<Record<string, unknown>> }
    expect(evidence.abstractEvidence?.[0]).toMatchObject({
      sourceId: result.sourceId,
      chapterDetection: "markdown_heading",
    })
    expect(JSON.stringify(evidence)).not.toContain(longSourceSentence)
  })

  test("unsupported corpus extension returns file type error", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    await writeArtifact("runs/current.json", { ...runState("event_selection"), projectId: project.projectId }, projectRoot)
    writeFileSync(join(projectRoot, "sample.pdf"), "not accepted")
    const tools = createAllTools()

    // #when / #then
    try {
      await tools.novel_ingest_corpus.execute({ files: ["sample.pdf"] }, ctx())
      throw new Error("Expected unsupported extension failure")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.UNSUPPORTED_CORPUS_FILE_TYPE)
      }
    }
  })

  test("oversize corpus file returns file too large error", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    await writeArtifact("runs/current.json", { ...runState("event_selection"), projectId: project.projectId }, projectRoot)
    writeFileSync(join(projectRoot, "oversize.md"), "0123456789")
    const tools = createAllTools()

    // #when / #then
    try {
      await tools.novel_ingest_corpus.execute({ files: ["oversize.md"], limits: { maxFileBytes: 5 } }, ctx())
      throw new Error("Expected oversize failure")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.CORPUS_FILE_TOO_LARGE)
      }
    }
  })

  test("duplicate corpus hash is skipped", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    await writeArtifact("runs/current.json", { ...runState("event_selection"), projectId: project.projectId }, projectRoot)
    writeFileSync(join(projectRoot, "duplicate.md"), "# Chapter\n\nSame authorized corpus body with system and revenge markers.")
    const tools = createAllTools()
    await tools.novel_ingest_corpus.execute({ files: ["duplicate.md"] }, ctx())

    // #when
    const output = parseToolOutput(await tools.novel_ingest_corpus.execute({ files: ["duplicate.md"] }, ctx()))

    // #then
    expect(output.ingested).toBe(0)
    expect(output.skipped).toBe(1)
    const result = (output.results as Array<Record<string, string>>)[0]
    expect(result.status).toBe("skipped")
    expect(result.reason).toBe("duplicate_hash")
  })

  test("status before initialization returns not initialized with next action", async () => {
    // #given
    const tools = createAllTools()

    // #when
    const output = parseToolOutput(await tools.novel_project_status.execute({}, ctx()))

    // #then
    expect(output.initialized).toBe(false)
    expect(output.nextAction).toBe("/novel-start or novel_init_project")
  })

  test("invalid stage transitions fail without updating the run", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    await writeArtifact("runs/current.json", { ...runState("interviewing"), projectId: project.projectId }, projectRoot)
    const tools = createAllTools()

    // #when / #then
    try {
      await tools.novel_advance_stage.execute({ to: "prose_draft" }, ctx())
      throw new Error("Expected transition failure")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.STAGE_TRANSITION_BLOCKED)
      }
    }
  })

  test("malformed review output fails validation and cannot satisfy stage advancement", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    const hash = computeArtifactHash("prose draft")
    const malformedReview = approvedReview(hash) as Record<string, unknown>
    delete malformedReview.status
    await writeArtifact("runs/current.json", { ...runState("prose_review"), projectId: project.projectId }, projectRoot)
    const tools = createAllTools()

    // #when / #then
    expect(() => ReviewResultSchema.parse(malformedReview)).toThrow()
    try {
      await tools.novel_advance_stage.execute({ to: "draft_ready" }, ctx())
      throw new Error("Expected review gate failure")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.REQUIRED_REVIEW_MISSING)
      }
    }
  })

  test("canon accept is blocked without passing fresh reviews", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    await writeArtifact("runs/current.json", { ...runState("canon_acceptance_pending"), projectId: project.projectId }, projectRoot)
    const tools = createAllTools()
    const hash = computeArtifactHash("final draft")

    // #when / #then
    try {
      await tools.novel_accept_canon.execute({
        explicitAcceptance: { acceptedBy: "editor-1", acceptedAt: createdAt, acceptedArtifactHash: hash, action: "accept_canon" },
        canonFactSet: canonFactSet(hash),
      }, ctx())
      throw new Error("Expected review gate failure")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.REQUIRED_REVIEW_MISSING)
      }
    }
  })

  test("recorded fresh approved review allows explicit canon acceptance", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    const hash = computeArtifactHash("final draft")
    const review = approvedReview(hash)
    await writeArtifact("runs/current.json", { ...runState("canon_acceptance_pending"), projectId: project.projectId, artifactIds: [review.artifactId] }, projectRoot)
    await writeArtifact("reviews/review-1.json", review, projectRoot)
    const tools = createAllTools()

    // #when
    const output = parseToolOutput(await tools.novel_accept_canon.execute({
      explicitAcceptance: { acceptedBy: "editor-1", acceptedAt: createdAt, acceptedArtifactHash: hash, action: "accept_canon" },
      canonFactSet: canonFactSet(hash),
    }, ctx()))

    // #then
    expect(output.accepted).toBe(true)
    expect((output.currentRun as RunState).stage).toBe("canon_accepted")
  })
})
