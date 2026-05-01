import { describe, expect, test } from "bun:test"
import { NovelError, NovelErrorCode } from "../../errors"
import { RequiredOutlineReviewGates, RequiredProseReviewGates, computeArtifactHash, type ReviewGateName, type ReviewResult, type ReviewStatus } from "../../schemas"
import { STAGES, StageGraph } from ".."

const createdAt = "2026-05-01T00:00:00.000Z"

function review(stage: ReviewResult["stage"], decision: ReviewResult["decision"], hash: string, gate: ReviewGateName = "logic-world-motivation"): ReviewResult {
  const status = decision === "approved" ? "pass" : "fail"
  return {
    schemaVersion: "1.0.0",
    artifactId: `${stage}-artifact`,
    runId: "run-1",
    createdAt,
    stage,
    sourceArtifactIds: ["artifact-1"],
    status,
    gate,
    severity: status === "pass" ? "info" : "blocking",
    blockingIssues: status === "pass" ? [] : [{ issue: "Needs revision", suggestedFix: "Revise the artifact." }],
    nonBlockingSuggestions: [],
    affectedArtifactIds: ["artifact-1"],
    artifactHash: hash,
    reason: status === "pass" ? "Review passed." : "Review failed.",
    suggestedFix: status === "pass" ? "No fix needed." : "Revise the artifact.",
    requiresUserDecision: false,
    reviewedArtifactId: "artifact-1",
    reviewedArtifactHash: hash,
    reviewedArtifactVersion: 1,
    decision,
    deltas: [],
    reviewerId: "reviewer-1",
  }
}


function outlineReview(stage: Extract<ReviewResult["stage"], "rough_outline_review" | "detailed_outline_review">, gate: ReviewGateName, status: ReviewStatus, hash: string): ReviewResult {
  return {
    ...review(stage, status === "pass" ? "approved" : "revision_required", hash, gate),
    artifactId: `${stage}-${gate}-${status}-review`,
    status,
    severity: status === "pass" ? "info" : "blocking",
    blockingIssues: status === "pass" ? [] : [{ issue: `${gate} issue`, suggestedFix: `${gate} fix` }],
    reason: status === "needs_user_input" ? "Which canon boundary should apply?" : `${gate} ${status}`,
    suggestedFix: status === "pass" ? "No fix needed." : `${gate} fix`,
    requiresUserDecision: status === "needs_user_input",
  }
}

function passingOutlineReviews(stage: Extract<ReviewResult["stage"], "rough_outline_review" | "detailed_outline_review">, hash: string): ReviewResult[] {
  return RequiredOutlineReviewGates.map((gate) => outlineReview(stage, gate, "pass", hash))
}

function proseReview(gate: ReviewGateName, status: ReviewStatus, hash: string): ReviewResult {
  return {
    ...review("prose_review", status === "pass" ? "approved" : "revision_required", hash),
    artifactId: `${gate}-${status}-review`,
    gate,
    status,
    severity: status === "pass" ? "info" : "blocking",
    blockingIssues: status === "pass" ? [] : [{ issue: `${gate} issue`, suggestedFix: `${gate} fix` }],
    reason: status === "needs_user_input" ? "Should the protagonist reveal the secret now?" : `${gate} ${status}`,
    suggestedFix: status === "pass" ? "No fix needed." : `${gate} fix`,
    requiresUserDecision: status === "needs_user_input",
  }
}

function passingProseReviews(hash: string): ReviewResult[] {
  return RequiredProseReviewGates.map((gate) => proseReview(gate, "pass", hash))
}

function expectNovelError(action: () => unknown, code: NovelErrorCode): void {
  try {
    action()
    throw new Error("Expected NovelError")
  } catch (error) {
    expect(error).toBeInstanceOf(NovelError)
    if (error instanceof NovelError) {
      expect(error.code).toBe(code)
    }
  }
}

describe("StageGraph", () => {
  test("defines all finite stages", () => {
    // #given / #when / #then
    expect(STAGES).toEqual([
      "uninitialized",
      "interviewing",
      "rough_outline_draft",
      "rough_outline_review",
      "rough_outline_revision_required",
      "detailed_outline_draft",
      "detailed_outline_review",
      "detailed_outline_revision_required",
      "event_selection",
      "prose_draft",
      "prose_review",
      "prose_revision_required",
      "draft_ready",
      "canon_acceptance_pending",
      "canon_accepted",
      "archived_without_acceptance",
    ])
  })

  test("invalid transitions fail with concrete error codes", () => {
    // #given / #when / #then
    expectNovelError(
      () => StageGraph.canTransition("uninitialized", "rough_outline_draft"),
      NovelErrorCode.STAGE_TRANSITION_BLOCKED
    )
  })

  test("interviewing cannot advance until required project gates are present", () => {
    // #given / #when / #then
    expectNovelError(
      () => StageGraph.canTransition("interviewing", "rough_outline_draft", { hasInterviewArtifact: true }),
      NovelErrorCode.STAGE_TRANSITION_BLOCKED
    )

    expect(StageGraph.canTransition("interviewing", "rough_outline_draft", {
      hasInterviewArtifact: true,
      hasTargetAudience: true,
      hasStoryObjective: true,
    })).toBe(true)
  })

  test("draft to review requires a draft artifact gate", () => {
    // #given / #when / #then
    expectNovelError(
      () => StageGraph.canTransition("rough_outline_draft", "rough_outline_review"),
      NovelErrorCode.STAGE_TRANSITION_BLOCKED
    )
    expect(StageGraph.canTransition("rough_outline_draft", "rough_outline_review", { hasDraftArtifact: true })).toBe(true)
  })

  test("review approval transitions require matching fresh review artifacts", () => {
    // #given
    const hash = computeArtifactHash("rough outline")
    const approvedReview = review("rough_outline_review", "approved", hash)

    // #when / #then
    expectNovelError(
      () => StageGraph.canTransition("rough_outline_review", "detailed_outline_draft"),
      NovelErrorCode.REQUIRED_REVIEW_MISSING
    )
    expect(StageGraph.canTransition("rough_outline_review", "detailed_outline_draft", {
      reviewGate: { review: approvedReview, currentArtifactHash: hash },
      reviewGateSet: { reviews: passingOutlineReviews("rough_outline_review", hash), currentArtifactHash: hash },
    })).toBe(true)
  })

  test("revision transitions require revision review decisions", () => {
    // #given
    const hash = computeArtifactHash("rough outline")
    const approvedReview = review("rough_outline_review", "approved", hash)
    const revisionReview = review("rough_outline_review", "revision_required", hash)

    // #when / #then
    expectNovelError(
      () => StageGraph.canTransition("rough_outline_review", "rough_outline_revision_required", {
        reviewGate: { review: approvedReview, currentArtifactHash: hash },
      }),
      NovelErrorCode.STAGE_TRANSITION_BLOCKED
    )
    expect(StageGraph.canTransition("rough_outline_review", "rough_outline_revision_required", {
      reviewGate: { review: revisionReview, currentArtifactHash: hash },
    })).toBe(true)
  })

  test("review artifact hashes invalidate stale approvals after content changes", () => {
    // #given
    const originalHash = computeArtifactHash("prose draft v1")
    const changedHash = computeArtifactHash("prose draft v2")
    const approvedReview = review("prose_review", "approved", originalHash)

    // #when / #then
    expectNovelError(
      () => StageGraph.canTransition("prose_review", "draft_ready", {
        reviewGate: { review: approvedReview, currentArtifactHash: changedHash },
      }),
      NovelErrorCode.REVIEW_ARTIFACT_STALE
    )
  })

  test("outline advancement requires all mandatory current passing review gates", () => {
    const hash = computeArtifactHash("detailed outline")
    const missingContinuity = passingOutlineReviews("detailed_outline_review", hash).filter((item) => item.gate !== "continuity")

    expectNovelError(
      () => StageGraph.canTransition("detailed_outline_review", "event_selection", {
        reviewGate: { review: missingContinuity[0], currentArtifactHash: hash },
        reviewGateSet: { reviews: missingContinuity, currentArtifactHash: hash },
      }),
      NovelErrorCode.REQUIRED_REVIEW_MISSING
    )

    expect(StageGraph.canTransition("detailed_outline_review", "event_selection", {
      reviewGate: { review: missingContinuity[0], currentArtifactHash: hash },
      reviewGateSet: { reviews: passingOutlineReviews("detailed_outline_review", hash), currentArtifactHash: hash },
    })).toBe(true)
  })

  test("outline advancement blocks stale failing and needs-user-input reviews", () => {
    const hash = computeArtifactHash("rough outline")
    const changedHash = computeArtifactHash("rough outline changed")
    const passing = passingOutlineReviews("rough_outline_review", hash)

    expectNovelError(
      () => StageGraph.canTransition("rough_outline_review", "detailed_outline_draft", {
        reviewGate: { review: passing[0], currentArtifactHash: changedHash },
        reviewGateSet: { reviews: passing, currentArtifactHash: changedHash },
      }),
      NovelErrorCode.REVIEW_ARTIFACT_STALE
    )

    expectNovelError(
      () => StageGraph.canTransition("rough_outline_review", "detailed_outline_draft", {
        reviewGate: { review: passing[0], currentArtifactHash: hash },
        reviewGateSet: { reviews: [...passing, outlineReview("rough_outline_review", "continuity", "fail", hash)], currentArtifactHash: hash },
      }),
      NovelErrorCode.STAGE_TRANSITION_BLOCKED
    )

    expectNovelError(
      () => StageGraph.canTransition("rough_outline_review", "detailed_outline_draft", {
        reviewGate: { review: passing[0], currentArtifactHash: hash },
        reviewGateSet: { reviews: passing.map((item) => item.gate === "preference-boundary" ? outlineReview("rough_outline_review", "preference-boundary", "needs_user_input", hash) : item), currentArtifactHash: hash },
      }),
      NovelErrorCode.STAGE_TRANSITION_BLOCKED
    )
  })

  test("prose advancement requires all four current passing review gates", () => {
    // #given
    const hash = computeArtifactHash("prose draft")
    const reviews = passingProseReviews(hash).filter((item) => item.gate !== "continuity")

    // #when / #then
    expectNovelError(
      () => StageGraph.canTransition("prose_review", "draft_ready", {
        reviewGate: { review: reviews[0], currentArtifactHash: hash },
        reviewGateSet: { reviews, currentArtifactHash: hash },
      }),
      NovelErrorCode.REQUIRED_REVIEW_MISSING
    )

    expect(StageGraph.canTransition("prose_review", "draft_ready", {
      reviewGate: { review: reviews[0], currentArtifactHash: hash },
      reviewGateSet: { reviews: passingProseReviews(hash), currentArtifactHash: hash },
    })).toBe(true)
  })

  test("blocking prose review failures dominate passing reviews", () => {
    // #given
    const hash = computeArtifactHash("prose draft")
    const reviews = [
      ...passingProseReviews(hash),
      proseReview("continuity", "fail", hash),
    ]

    // #when / #then
    expectNovelError(
      () => StageGraph.canTransition("prose_review", "draft_ready", {
        reviewGate: { review: reviews[0], currentArtifactHash: hash },
        reviewGateSet: { reviews, currentArtifactHash: hash },
      }),
      NovelErrorCode.STAGE_TRANSITION_BLOCKED
    )
  })

  test("needs user input blocks prose advancement with the review question", () => {
    // #given
    const hash = computeArtifactHash("prose draft")
    const reviews = passingProseReviews(hash).map((item) => item.gate === "preference-boundary"
      ? proseReview("preference-boundary", "needs_user_input", hash)
      : item)

    // #when / #then
    try {
      StageGraph.canTransition("prose_review", "draft_ready", {
        reviewGate: { review: reviews[0], currentArtifactHash: hash },
        reviewGateSet: { reviews, currentArtifactHash: hash },
      })
      throw new Error("Expected NovelError")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.STAGE_TRANSITION_BLOCKED)
        expect(error.message).toContain("Should the protagonist reveal the secret now?")
      }
    }
  })

  test("canon acceptance requires explicit action", () => {
    // #given / #when / #then
    expectNovelError(
      () => StageGraph.canTransition("canon_acceptance_pending", "canon_accepted"),
      NovelErrorCode.CANON_ACCEPTANCE_REQUIRES_EXPLICIT_ACTION
    )

    expect(StageGraph.canTransition("canon_acceptance_pending", "canon_accepted", {
      explicitCanonAcceptance: {
        acceptedBy: "editor-1",
        acceptedAt: createdAt,
        acceptedArtifactHash: computeArtifactHash("final draft"),
        action: "accept_canon",
      },
    })).toBe(true)
  })

  test("reports next stages and required gates", () => {
    // #given / #when / #then
    expect(StageGraph.getNextStages("rough_outline_review")).toEqual([
      "detailed_outline_draft",
      "rough_outline_revision_required",
    ])
    expect(StageGraph.getRequiredGates("rough_outline_review")).toEqual(["reviewGate"])
  })
})
