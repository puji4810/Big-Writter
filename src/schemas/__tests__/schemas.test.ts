import { describe, expect, test } from "bun:test"
import {
  CanonFactSetSchema,
  CorpusSourceSchema,
  DetailedOutlineArtifactSchema,
  EvidencePackSchema,
  InterviewArtifactSchema,
  NovelProjectSchema,
  PreferenceBoundaryProfileSchema,
  ProvenanceMetaSchema,
  ReviewResultSchema,
  RoughOutlineArtifactSchema,
  RunStateSchema,
  SyncStatusSchema,
  computeArtifactHash,
  isReviewStale,
} from ".."
import {
  ActiveOutlinePointerSchema,
  ActiveProsePointerSchema,
  ActiveCharacterCompilationPointerSchema,
} from "../run"

const createdAt = "2026-05-01T00:00:00.000Z"

const baseArtifact = {
  schemaVersion: "1.0.0",
  artifactId: "artifact-1",
  runId: "run-1",
  createdAt,
  sourceArtifactIds: [],
  status: "draft",
}

describe("novel schemas", () => {
  test("all top-level schemas accept schemaVersion", () => {
    // #given
    const inputs = [
      [NovelProjectSchema, {
        schemaVersion: "1.0.0",
        projectId: "project-1",
        title: "A Lantern in Rain",
        premise: "A courier learns the city remembers every promise.",
        targetAudience: "serialized fantasy readers",
        storyObjective: "deliver a complete pilot arc",
        createdAt,
        updatedAt: createdAt,
      }],
      [RunStateSchema, {
        schemaVersion: "1.0.0",
        runId: "run-1",
        projectId: "project-1",
        stage: "interviewing",
        artifactIds: [],
        updatedAt: createdAt,
      }],
      [CorpusSourceSchema, {
        schemaVersion: "1.0.0",
        sourceId: "source-1",
        projectId: "project-1",
        kind: "interview",
        title: "Initial interview",
        contentHash: computeArtifactHash("source"),
        createdAt,
      }],
      [PreferenceBoundaryProfileSchema, {
        schemaVersion: "1.0.0",
        projectId: "project-1",
        profileId: "profile-1",
        preferredTone: ["intimate"],
        avoidedContent: ["gratuitous gore"],
        hardBoundaries: ["no explicit sexual content"],
        updatedAt: createdAt,
      }],
    ] as const

    // #when / #then
    for (const [schema, input] of inputs) {
      expect(schema.safeParse(input).success).toBe(true)
    }
  })

  test("run artifacts require run metadata", () => {
    // #given
    const interview = {
      ...baseArtifact,
      stage: "interviewing",
      questions: [{ question: "What is the promise?", answer: "A lost vow." }],
      summary: "The story begins with a broken vow.",
    }
    const missingRunId = { ...interview, runId: "" }

    // #when
    const validResult = InterviewArtifactSchema.safeParse(interview)
    const invalidResult = InterviewArtifactSchema.safeParse(missingRunId)

    // #then
    expect(validResult.success).toBe(true)
    expect(invalidResult.success).toBe(false)
  })

  test("outline and review schemas carry versioned hashes", () => {
    // #given
    const roughHash = computeArtifactHash("rough outline v1")
    const roughOutline = {
      ...baseArtifact,
      stage: "rough_outline_draft",
      logline: "A courier delivers a promise to a haunted city.",
      acts: [{ title: "Act One", summary: "The vow is found." }],
      contentHash: roughHash,
      version: 1,
    }
    const review = {
      ...baseArtifact,
      artifactId: "review-1",
      stage: "rough_outline_review",
      status: "pass",
      sourceArtifactIds: ["artifact-1"],
      gate: "logic-world-motivation",
      severity: "info",
      blockingIssues: [],
      nonBlockingSuggestions: ["Tighten one transition."],
      affectedArtifactIds: ["artifact-1"],
      artifactHash: roughHash,
      reason: "The rough outline is coherent.",
      suggestedFix: "No blocking fix needed.",
      requiresUserDecision: false,
      reviewedArtifactId: "artifact-1",
      reviewedArtifactHash: roughHash,
      reviewedArtifactVersion: 1,
      decision: "approved",
      deltas: [],
      reviewerId: "reviewer-1",
    }

    // #when
    const outlineResult = RoughOutlineArtifactSchema.safeParse(roughOutline)
    const reviewResult = ReviewResultSchema.safeParse(review)

    // #then
    expect(outlineResult.success).toBe(true)
    expect(reviewResult.success).toBe(true)
    if (reviewResult.success) {
      expect(reviewResult.data.status).toBe("pass")
      expect(isReviewStale(reviewResult.data, roughHash)).toBe(false)
      expect(isReviewStale(reviewResult.data, computeArtifactHash("rough outline v2"))).toBe(true)
    }
  })

  test("legacy review status values normalize to typed review status", () => {
    // #given
    const roughHash = computeArtifactHash("rough outline v1")
    const review = {
      ...baseArtifact,
      artifactId: "review-legacy",
      stage: "rough_outline_review",
      status: "approved",
      sourceArtifactIds: ["artifact-1"],
      gate: "logic-world-motivation",
      severity: "info",
      blockingIssues: [],
      nonBlockingSuggestions: [],
      affectedArtifactIds: ["artifact-1"],
      artifactHash: roughHash,
      reason: "Legacy review is still accepted.",
      suggestedFix: "No fix needed.",
      requiresUserDecision: false,
      reviewedArtifactId: "artifact-1",
      reviewedArtifactHash: roughHash,
      reviewedArtifactVersion: 1,
      decision: "approved",
      deltas: [],
      reviewerId: "reviewer-1",
    }

    // #when
    const result = ReviewResultSchema.safeParse(review)

    // #then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.status).toBe("pass")
    }
  })

  test("detailed outline, evidence, and canon artifacts validate run artifact fields", () => {
    // #given
    const detailedOutline = {
      ...baseArtifact,
      stage: "detailed_outline_draft",
      chapters: [{ chapterNumber: 1, title: "Rain Market", synopsis: "The courier arrives.", keyEvents: ["The lantern speaks."] }],
      contentHash: computeArtifactHash("detailed"),
      version: 1,
    }
    const evidencePack = {
      ...baseArtifact,
      artifactId: "evidence-1",
      stage: "event_selection",
      sourceIds: ["source-1"],
      claims: [{ claim: "The city remembers promises.", sourceIds: ["source-1"] }],
    }
    const canonFactSet = {
      ...baseArtifact,
      artifactId: "canon-1",
      stage: "canon_accepted",
      status: "accepted",
      acceptedArtifactHash: computeArtifactHash("draft"),
      facts: [{ factId: "fact-1", subject: "city", predicate: "remembers", object: "promises", evidenceArtifactIds: ["artifact-1"] }],
    }

    // #when / #then
    expect(DetailedOutlineArtifactSchema.safeParse(detailedOutline).success).toBe(true)
    expect(EvidencePackSchema.safeParse(evidencePack).success).toBe(true)
    expect(CanonFactSetSchema.safeParse(canonFactSet).success).toBe(true)
  })

  test("RunState parses with active artifact pointers populated", () => {
    const now = new Date().toISOString()
    const run = {
      schemaVersion: "1.0.0",
      runId: "run-1",
      projectId: "project-1",
      stage: "prose_draft",
      artifactIds: ["artifact-1"],
      updatedAt: createdAt,
      activeRoughOutline: {
        artifactId: "rough-1",
        markdownPath: "outlines/rough/rough-1.md",
        markdownHash: computeArtifactHash("rough outline markdown"),
        templateVersion: "1.0.0",
        compiledAt: now,
        syncStatus: "clean",
      },
      activeDetailedOutline: {
        artifactId: "detailed-1",
        markdownPath: "outlines/detailed/detailed-1.md",
        markdownHash: computeArtifactHash("detailed outline markdown"),
        templateVersion: "1.0.0",
        compiledAt: now,
        syncStatus: "clean",
      },
      activeProseSelection: {
        artifactId: "draft-1",
        eventReference: "chapter-3-scene-2",
      },
      activeCharacterCompilation: {
        markdownPath: "canon/characters.md",
        compiledAt: now,
        fileCount: 3,
      },
    }

    const result = RunStateSchema.safeParse(run)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.activeRoughOutline?.artifactId).toBe("rough-1")
      expect(result.data.activeDetailedOutline?.syncStatus).toBe("clean")
      expect(result.data.activeProseSelection?.eventReference).toBe("chapter-3-scene-2")
      expect(result.data.activeCharacterCompilation?.fileCount).toBe(3)
    }
  })

  test("RunState accepts undefined active pointers (backward compatible)", () => {
    const legacyRun = {
      schemaVersion: "1.0.0",
      runId: "run-legacy",
      projectId: "project-1",
      stage: "interviewing",
      artifactIds: [],
      updatedAt: createdAt,
    }

    const result = RunStateSchema.safeParse(legacyRun)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.activeRoughOutline).toBeUndefined()
      expect(result.data.activeDetailedOutline).toBeUndefined()
      expect(result.data.activeProseSelection).toBeUndefined()
      expect(result.data.activeCharacterCompilation).toBeUndefined()
    }
  })

  test("RunState accepts null active pointers", () => {
    const run = {
      schemaVersion: "1.0.0",
      runId: "run-null-pointers",
      projectId: "project-1",
      stage: "rough_outline_draft",
      artifactIds: [],
      updatedAt: createdAt,
      activeRoughOutline: null,
      activeDetailedOutline: null,
      activeProseSelection: null,
      activeCharacterCompilation: null,
    }

    const result = RunStateSchema.safeParse(run)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.activeRoughOutline).toBeNull()
      expect(result.data.activeDetailedOutline).toBeNull()
      expect(result.data.activeProseSelection).toBeNull()
      expect(result.data.activeCharacterCompilation).toBeNull()
    }
  })

  test("SyncStatusSchema validates all four statuses", () => {
    expect(SyncStatusSchema.safeParse("clean").success).toBe(true)
    expect(SyncStatusSchema.safeParse("stale_markdown").success).toBe(true)
    expect(SyncStatusSchema.safeParse("compile_failed").success).toBe(true)
    expect(SyncStatusSchema.safeParse("orphaned_generated").success).toBe(true)
    expect(SyncStatusSchema.safeParse("unknown_status").success).toBe(false)
  })

  test("ProvenanceMetaSchema validates compiled artifact provenance", () => {
    const now = new Date().toISOString()
    const valid = {
      sourcePath: "outlines/rough/rough-1.md",
      markdownHash: computeArtifactHash("markdown content"),
      templateVersion: "2.0.0",
      compiledAt: now,
    }

    expect(ProvenanceMetaSchema.safeParse(valid).success).toBe(true)
    expect(ProvenanceMetaSchema.safeParse({ ...valid, sourcePath: "" }).success).toBe(false)
    expect(ProvenanceMetaSchema.safeParse({ ...valid, markdownHash: "" }).success).toBe(false)
    expect(ProvenanceMetaSchema.safeParse({ ...valid, unknownKey: "val" }).success).toBe(false)
  })

  test("ActiveOutlinePointerSchema rejects unknown extra keys", () => {
    const now = new Date().toISOString()
    const valid = {
      artifactId: "rough-1",
      markdownPath: "outlines/rough/rough-1.md",
      markdownHash: computeArtifactHash("content"),
      templateVersion: "1.0.0",
      compiledAt: now,
      syncStatus: "clean",
    }

    expect(ActiveOutlinePointerSchema.safeParse(valid).success).toBe(true)
    expect(ActiveOutlinePointerSchema.safeParse({
      ...valid,
      extraField: "should not be here",
    }).success).toBe(false)
  })

  test("ActiveProsePointerSchema validates required fields", () => {
    const valid = {
      artifactId: "draft-3",
      eventReference: "chapter-5-bridge",
    }

    expect(ActiveProsePointerSchema.safeParse(valid).success).toBe(true)
    expect(ActiveProsePointerSchema.safeParse({ ...valid, eventReference: "" }).success).toBe(false)
    expect(ActiveProsePointerSchema.safeParse({ ...valid, extra: true }).success).toBe(false)
  })

  test("ActiveCharacterCompilationPointerSchema validates compilation metadata", () => {
    const now = new Date().toISOString()
    const valid = {
      markdownPath: "canon/characters-compiled.md",
      compiledAt: now,
      fileCount: 5,
    }

    expect(ActiveCharacterCompilationPointerSchema.safeParse(valid).success).toBe(true)
    expect(ActiveCharacterCompilationPointerSchema.safeParse({ ...valid, fileCount: -1 }).success).toBe(false)
    expect(ActiveCharacterCompilationPointerSchema.safeParse({ ...valid, markdownPath: "" }).success).toBe(false)
  })

  test("RunState with active pointers still rejects unknown top-level keys", () => {
    const run = {
      schemaVersion: "1.0.0",
      runId: "run-1",
      projectId: "project-1",
      stage: "interviewing",
      artifactIds: [],
      updatedAt: createdAt,
      unknownTopLevel: "should fail",
    }

    expect(RunStateSchema.safeParse(run).success).toBe(false)
  })
})
