import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RequiredOutlineReviewGates, RequiredProseReviewGates, SCHEMA_VERSION, computeArtifactHash, type ReviewGateName, type ReviewResult, type ReviewStage, type RunState } from "../schemas"
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

function approvedReview(stage: ReviewStage, artifactId: string, reviewedArtifactId: string, hash: string, gate: ReviewGateName = "logic-world-motivation"): ReviewResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId,
    runId: "run-1",
    createdAt,
    stage,
    sourceArtifactIds: [reviewedArtifactId],
    status: "pass",
    gate,
    severity: "info",
    blockingIssues: [],
    nonBlockingSuggestions: [],
    affectedArtifactIds: [reviewedArtifactId],
    artifactHash: hash,
    reason: `${gate} passed.`,
    suggestedFix: "No fix needed.",
    requiresUserDecision: false,
    reviewedArtifactId,
    reviewedArtifactHash: hash,
    reviewedArtifactVersion: 1,
    decision: "approved",
    deltas: [],
    reviewerId: `${gate}-reviewer`,
  }
}

describe("closed-loop novel workflow", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-integration-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("runs deterministic init to canon accepted flow without live LLM calls", async () => {
    // #given
    const tools = createAllTools()

    // #when
    const initOutput = parseToolOutput(await tools.novel_init_project.execute({}, ctx()))
    const initialRun = initOutput.currentRun as RunState
    expect(initialRun.stage).toBe("uninitialized")

    const interview = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "interview-1",
      runId: initialRun.runId,
      createdAt,
      stage: "interviewing",
      sourceArtifactIds: [],
      status: "draft",
      questions: [{ question: "What is the premise?", answer: "A courier challenges a corrupt cultivation academy." }],
      summary: "Premise, target audience, and story objective are confirmed.",
    }
    await tools.novel_write_artifact.execute({ artifact: { kind: "interview", artifactId: "interview-1" }, payload: interview }, ctx())

    let output = parseToolOutput(await tools.novel_advance_stage.execute({ to: "interviewing" }, ctx()))
    expect(output.to).toBe("interviewing")

    output = parseToolOutput(await tools.novel_advance_stage.execute({
      to: "rough_outline_draft",
      gates: { hasInterviewArtifact: true, hasTargetAudience: true, hasStoryObjective: true },
    }, ctx()))
    expect(output.to).toBe("rough_outline_draft")

    const roughContent = "Courier enters academy, uncovers contract fraud, and chooses public resistance."
    const roughHash = computeArtifactHash(roughContent)
    const roughOutline = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "rough-1",
      runId: initialRun.runId,
      createdAt,
      stage: "rough_outline_draft",
      sourceArtifactIds: ["interview-1"],
      status: "ready_for_review",
      logline: "A contract courier exposes a rigged academy trial.",
      acts: [{ title: "Academy Trial", summary: roughContent }],
      contentHash: roughHash,
      version: 1,
    }
    await tools.novel_write_artifact.execute({ artifact: { kind: "rough_outline", artifactId: "rough-1" }, payload: roughOutline }, ctx())
    output = parseToolOutput(await tools.novel_advance_stage.execute({ to: "rough_outline_review", gates: { hasDraftArtifact: true } }, ctx()))
    expect(output.to).toBe("rough_outline_review")

    const roughReviews = RequiredOutlineReviewGates.map((gate) => approvedReview("rough_outline_review", `rough-${gate}-review-1`, "rough-1", roughHash, gate))
    for (const review of roughReviews) {
      await tools.novel_record_review.execute({ review }, ctx())
    }
    output = parseToolOutput(await tools.novel_advance_stage.execute({
      to: "detailed_outline_draft",
      gates: {
        reviewGate: { review: roughReviews[0], currentArtifactHash: roughHash },
        reviewGateSet: { reviews: roughReviews, currentArtifactHash: roughHash },
      },
    }, ctx()))
    expect(output.to).toBe("detailed_outline_draft")

    const detailedContent = "Chapter 1: courier selects the public evidence event and refuses a hidden bribe."
    const detailedHash = computeArtifactHash(detailedContent)
    const detailedOutline = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "detailed-1",
      runId: initialRun.runId,
      createdAt,
      stage: "detailed_outline_draft",
      sourceArtifactIds: ["rough-1"],
      status: "ready_for_review",
      chapters: [{ chapterNumber: 1, title: "Public Evidence", synopsis: detailedContent, keyEvents: ["event-1"] }],
      contentHash: detailedHash,
      version: 1,
    }
    await tools.novel_write_artifact.execute({ artifact: { kind: "detailed_outline", artifactId: "detailed-1" }, payload: detailedOutline }, ctx())
    output = parseToolOutput(await tools.novel_advance_stage.execute({ to: "detailed_outline_review", gates: { hasDraftArtifact: true } }, ctx()))
    expect(output.to).toBe("detailed_outline_review")

    const detailedReviews = RequiredOutlineReviewGates.map((gate) => approvedReview("detailed_outline_review", `detailed-${gate}-review-1`, "detailed-1", detailedHash, gate))
    for (const review of detailedReviews) {
      await tools.novel_record_review.execute({ review }, ctx())
    }
    output = parseToolOutput(await tools.novel_advance_stage.execute({
      to: "event_selection",
      gates: {
        reviewGate: { review: detailedReviews[0], currentArtifactHash: detailedHash },
        reviewGateSet: { reviews: detailedReviews, currentArtifactHash: detailedHash },
      },
    }, ctx()))
    expect(output.to).toBe("event_selection")

    output = parseToolOutput(await tools.novel_advance_stage.execute({ to: "prose_draft" }, ctx()))
    expect(output.to).toBe("prose_draft")

    const prose = "Lin Zhou placed the bronze token on the hearing table and read each contract number aloud."
    const proseHash = computeArtifactHash(prose)
    const draft = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "draft-1",
      runId: initialRun.runId,
      createdAt,
      stage: "prose_draft",
      sourceArtifactIds: ["detailed-1"],
      status: "ready_for_review",
      proseContent: prose,
      factAssumptions: [{ subject: "Lin Zhou", predicate: "presents", object: "contract evidence" }],
      eventReference: "event-1",
      contentHash: proseHash,
      version: 1,
    }
    await tools.novel_write_artifact.execute({ artifact: { kind: "draft", artifactId: "draft-1" }, payload: draft }, ctx())
    output = parseToolOutput(await tools.novel_advance_stage.execute({ to: "prose_review", gates: { hasDraftArtifact: true } }, ctx()))
    expect(output.to).toBe("prose_review")

    const proseReviews = RequiredProseReviewGates.map((gate) => approvedReview("prose_review", `${gate}-review-1`, "draft-1", proseHash, gate))
    for (const review of proseReviews) {
      await tools.novel_record_review.execute({ review }, ctx())
    }
    output = parseToolOutput(await tools.novel_advance_stage.execute({
      to: "draft_ready",
      gates: {
        reviewGate: { review: proseReviews[0], currentArtifactHash: proseHash },
        reviewGateSet: { reviews: proseReviews, currentArtifactHash: proseHash },
      },
    }, ctx()))
    expect(output.to).toBe("draft_ready")

    output = parseToolOutput(await tools.novel_advance_stage.execute({ to: "canon_acceptance_pending" }, ctx()))
    expect(output.to).toBe("canon_acceptance_pending")

    output = parseToolOutput(await tools.novel_accept_canon.execute({
      explicitAcceptance: { acceptedBy: "editor-1", acceptedAt: createdAt, acceptedArtifactHash: proseHash, action: "accept_canon" },
    }, ctx()))

    // #then
    expect(output.accepted).toBe(true)
    expect((output.currentRun as RunState).stage).toBe("canon_accepted")
  })
})
