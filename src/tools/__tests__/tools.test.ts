import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { NovelError, NovelErrorCode } from "../../errors"
import { ReviewResultSchema, SCHEMA_VERSION, computeArtifactHash, type CanonFactSet, type ReviewResult, type RunState } from "../../schemas"
import { initNovelProject, readArtifact, writeArtifact } from "../../storage"
import {
  computeMarkdownHash,
  buildProvenanceMeta,
  isMarkdownStale,
  resolveActiveRoughOutline,
  resolveActiveDetailedOutline,
} from "../../orchestration/provenance"
import {
  getActiveRoughOutlineArtifactId,
  getActiveDetailedOutlineArtifactId,
  getActiveProseArtifactId,
  getActiveCharacterCompilation,
  isRunUpgraded,
} from "../common"
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

  test("computeMarkdownHash produces deterministic sha256", () => {
    const hash1 = computeMarkdownHash("# Chapter One\n\nThe courier arrives.")
    const hash2 = computeMarkdownHash("# Chapter One\n\nThe courier arrives.")
    const hash3 = computeMarkdownHash("# Chapter One\n\nThe courier leaves.")

    expect(hash1).toBe(hash2)
    expect(hash1).not.toBe(hash3)
    expect(hash1.length).toBe(64)
  })

  test("buildProvenanceMeta generates full provenance metadata", () => {
    const meta = buildProvenanceMeta({
      sourcePath: "outlines/rough/rough-1.md",
      markdownContent: "# Rough Outline\n\nLogline here.",
      templateVersion: "2.1.0",
    })

    expect(meta.sourcePath).toBe("outlines/rough/rough-1.md")
    expect(meta.markdownHash.length).toBe(64)
    expect(meta.templateVersion).toBe("2.1.0")
    expect(new Date(meta.compiledAt).getTime()).toBeLessThanOrEqual(Date.now())
    expect(new Date(meta.compiledAt).getTime()).toBeGreaterThan(Date.now() - 10_000)
  })

  test("isRunUpgraded detects runs with and without active pointers", () => {
    const legacy = runState("interviewing")
    const upgraded: RunState = {
      ...runState("prose_draft"),
      activeRoughOutline: {
        artifactId: "rough-1",
        markdownPath: "outlines/rough/rough-1.md",
        markdownHash: computeArtifactHash("markdown"),
        templateVersion: "1.0.0",
        compiledAt: createdAt,
        syncStatus: "clean",
      },
    }

    expect(isRunUpgraded(legacy)).toBe(false)
    expect(isRunUpgraded(upgraded)).toBe(true)
  })

  test("getActiveRoughOutlineArtifactId returns artifactId from pointer", () => {
    const run: RunState = {
      ...runState("rough_outline_draft"),
      activeRoughOutline: {
        artifactId: "rough-outline-42",
        markdownPath: "outlines/rough/rough-42.md",
        markdownHash: computeArtifactHash("outline content"),
        templateVersion: "1.0.0",
        compiledAt: createdAt,
        syncStatus: "clean",
      },
    }

    expect(getActiveRoughOutlineArtifactId(run)).toBe("rough-outline-42")
  })

  test("getActiveRoughOutlineArtifactId returns null for legacy run", () => {
    const run = runState("interviewing")
    expect(getActiveRoughOutlineArtifactId(run)).toBeNull()
  })

  test("getActiveDetailedOutlineArtifactId and getActiveProseArtifactId resolve correctly", () => {
    const run: RunState = {
      ...runState("prose_draft"),
      activeDetailedOutline: {
        artifactId: "detailed-7",
        markdownPath: "outlines/detailed/detailed-7.md",
        markdownHash: computeArtifactHash("detailed content"),
        templateVersion: "1.0.0",
        compiledAt: createdAt,
        syncStatus: "clean",
      },
      activeProseSelection: {
        artifactId: "draft-99",
        eventReference: "chapter-2-opener",
      },
    }

    expect(getActiveDetailedOutlineArtifactId(run)).toBe("detailed-7")
    expect(getActiveProseArtifactId(run)).toBe("draft-99")
  })

  test("getActiveCharacterCompilation returns the pointer or null", () => {
    const runWithout: RunState = runState("interviewing")
    const runWith: RunState = {
      ...runState("prose_draft"),
      activeCharacterCompilation: {
        markdownPath: "canon/characters.md",
        compiledAt: createdAt,
        fileCount: 4,
      },
    }

    expect(getActiveCharacterCompilation(runWithout)).toBeNull()
    const ptr = getActiveCharacterCompilation(runWith)
    expect(ptr).not.toBeNull()
    if (ptr) {
      expect(ptr.fileCount).toBe(4)
    }
  })

  test("isMarkdownStale returns false when markdown matches stored hash", async () => {
    const project = await initNovelProject(projectRoot)
    const markdownContent = "# Rough Outline\n\nA courier arrives in rain."
    const markdownPath = "outlines/rough/active.md"
    const hash = computeMarkdownHash(markdownContent)

    const markdownDir = join(projectRoot, ".novel", "outlines", "rough")
    mkdirSync(markdownDir, { recursive: true })
    writeFileSync(join(markdownDir, "active.md"), markdownContent)

    const run: RunState = {
      ...runState("rough_outline_draft"),
      activeRoughOutline: {
        artifactId: "rough-1",
        markdownPath,
        markdownHash: hash,
        templateVersion: "1.0.0",
        compiledAt: createdAt,
        syncStatus: "clean",
      },
    }
    await writeArtifact("runs/current.json", { ...run, projectId: project.projectId }, projectRoot)

    const stale = await isMarkdownStale(run, "rough_outline", projectRoot)
    expect(stale).toBe(false)
  })

  test("isMarkdownStale returns true after markdown change", async () => {
    const project = await initNovelProject(projectRoot)
    const originalContent = "# Original\n\nContent."
    const markdownPath = "outlines/rough/changed.md"
    const originalHash = computeMarkdownHash(originalContent)

    const markdownDir = join(projectRoot, ".novel", "outlines", "rough")
    mkdirSync(markdownDir, { recursive: true })
    writeFileSync(join(markdownDir, "changed.md"), originalContent)

    const run: RunState = {
      ...runState("rough_outline_draft"),
      activeRoughOutline: {
        artifactId: "rough-2",
        markdownPath,
        markdownHash: originalHash,
        templateVersion: "1.0.0",
        compiledAt: createdAt,
        syncStatus: "clean",
      },
    }
    await writeArtifact("runs/current.json", { ...run, projectId: project.projectId }, projectRoot)

    writeFileSync(join(markdownDir, "changed.md"), "# Modified\n\nNew content.")

    const stale = await isMarkdownStale(run, "rough_outline", projectRoot)
    expect(stale).toBe(true)
  })

  test("isMarkdownStale returns false when no active pointer exists", async () => {
    const run = runState("interviewing")
    const stale = await isMarkdownStale(run, "rough_outline", projectRoot)
    expect(stale).toBe(false)
  })

  test("resolveActiveRoughOutline finds artifact using active pointer", async () => {
    const project = await initNovelProject(projectRoot)
    const outline = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "rough-active-1",
      runId: "run-1",
      createdAt,
      stage: "rough_outline_draft",
      sourceArtifactIds: [],
      status: "draft",
      logline: "A courier returns a lost vow.",
      acts: [{ title: "Act One", summary: "The vow is found." }],
      contentHash: computeArtifactHash("outline"),
      version: 1,
    }
    await writeArtifact("outlines/rough/rough-active-1.json", outline, projectRoot)

    const run: RunState = {
      ...runState("rough_outline_draft"),
      projectId: project.projectId,
      activeRoughOutline: {
        artifactId: "rough-active-1",
        markdownPath: "outlines/rough/rough-active-1.md",
        markdownHash: computeArtifactHash("md"),
        templateVersion: "1.0.0",
        compiledAt: createdAt,
        syncStatus: "clean",
      },
    }

    const resolved = await resolveActiveRoughOutline(run, projectRoot)
    expect(resolved).not.toBeNull()
    if (resolved) {
      expect(resolved.artifactId).toBe("rough-active-1")
      expect(resolved.logline).toBe("A courier returns a lost vow.")
    }
  })

  test("resolveActiveRoughOutline returns null when pointer is missing", async () => {
    const run = runState("interviewing")
    const resolved = await resolveActiveRoughOutline(run, projectRoot)
    expect(resolved).toBeNull()
  })

  test("resolveActiveDetailedOutline returns null when artifact is missing", async () => {
    const project = await initNovelProject(projectRoot)
    const run: RunState = {
      ...runState("detailed_outline_draft"),
      projectId: project.projectId,
      activeDetailedOutline: {
        artifactId: "nonexistent-detailed",
        markdownPath: "outlines/detailed/none.md",
        markdownHash: computeArtifactHash("none"),
        templateVersion: "1.0.0",
        compiledAt: createdAt,
        syncStatus: "clean",
      },
    }

    const resolved = await resolveActiveDetailedOutline(run, projectRoot)
    expect(resolved).toBeNull()
  })

  test("novel_write_artifact description names all eight writable artifact kinds", () => {
    const tools = createAllTools()
    const desc = tools.novel_write_artifact.description
    const requiredKinds = ["interview", "rough_outline", "detailed_outline", "draft", "review", "evidence_pack", "canon_fact_set", "boundary_profile"]
    for (const kind of requiredKinds) {
      expect(desc).toContain(kind)
    }
  })

  test("novel_write_artifact description distinguishes artifact selector from payload body", () => {
    const tools = createAllTools()
    const desc = tools.novel_write_artifact.description
    expect(desc).toContain("artifact")
    expect(desc).toContain("payload")
    const hasDistinction = /\breference\b/.test(desc) || desc.includes("body") || desc.includes("schema object")
    expect(hasDistinction).toBe(true)
  })

  test("novel_write_artifact description names run artifact base fields", () => {
    const tools = createAllTools()
    const desc = tools.novel_write_artifact.description
    const fields = ["schemaVersion", "artifactId", "runId", "createdAt", "stage", "sourceArtifactIds", "status"]
    for (const field of fields) {
      expect(desc).toContain(field)
    }
  })

  test("novel_write_artifact description contains strict no-extra-keys warning", () => {
    const tools = createAllTools()
    const desc = tools.novel_write_artifact.description
    const hasWarning = desc.includes("strict") || desc.includes("no extra") || desc.includes("no additional") || desc.includes("no unknown")
    expect(hasWarning).toBe(true)
  })

  test("novel_write_artifact interview guidance names required fields and warns against legacy keys", () => {
    const tools = createAllTools()
    const desc = tools.novel_write_artifact.description
    expect(desc).toContain("questions")
    expect(desc).toContain("summary")
    expect(desc).toContain("interviewing")
    const legacyWarnings = ["premise", "genre", "tone", "hardBoundaries"].filter(k => desc.includes(k))
    expect(legacyWarnings.length).toBeGreaterThanOrEqual(3)
  })

  test("novel_advance_stage description mentions all three interviewing gates", () => {
    const tools = createAllTools()
    const desc = tools.novel_advance_stage.description
    expect(desc).toContain("hasInterviewArtifact")
    expect(desc).toContain("hasTargetAudience")
    expect(desc).toContain("hasStoryObjective")
  })
})
