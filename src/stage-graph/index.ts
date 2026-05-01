import { NovelError, NovelErrorCode } from "../errors"
import { RequiredOutlineReviewGates, RequiredProseReviewGates, isReviewStale, type StageGateInput } from "../schemas/review"
import type { ReviewDecision, ReviewGateName, ReviewResult, ReviewStage } from "../schemas/review"
import type { Stage } from "../schemas/run"

export const STAGES = [
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
] as const satisfies readonly Stage[]

type TransitionRule = {
  to: Stage
  requiredGates: string[]
  decision?: ReviewDecision
}

const transitionRules: Record<Stage, TransitionRule[]> = {
  uninitialized: [{ to: "interviewing", requiredGates: [] }],
  interviewing: [{ to: "rough_outline_draft", requiredGates: ["hasInterviewArtifact", "hasTargetAudience", "hasStoryObjective"] }],
  rough_outline_draft: [{ to: "rough_outline_review", requiredGates: ["hasDraftArtifact"] }],
  rough_outline_review: [
    { to: "detailed_outline_draft", requiredGates: ["reviewGate"], decision: "approved" },
    { to: "rough_outline_revision_required", requiredGates: ["reviewGate"], decision: "revision_required" },
  ],
  rough_outline_revision_required: [{ to: "rough_outline_draft", requiredGates: [] }],
  detailed_outline_draft: [{ to: "detailed_outline_review", requiredGates: ["hasDraftArtifact"] }],
  detailed_outline_review: [
    { to: "event_selection", requiredGates: ["reviewGate"], decision: "approved" },
    { to: "detailed_outline_revision_required", requiredGates: ["reviewGate"], decision: "revision_required" },
  ],
  detailed_outline_revision_required: [{ to: "detailed_outline_draft", requiredGates: [] }],
  event_selection: [{ to: "prose_draft", requiredGates: [] }],
  prose_draft: [{ to: "prose_review", requiredGates: ["hasDraftArtifact"] }],
  prose_review: [
    { to: "draft_ready", requiredGates: ["reviewGate"], decision: "approved" },
    { to: "prose_revision_required", requiredGates: ["reviewGate"], decision: "revision_required" },
  ],
  prose_revision_required: [{ to: "prose_draft", requiredGates: [] }],
  draft_ready: [{ to: "canon_acceptance_pending", requiredGates: [] }],
  canon_acceptance_pending: [
    { to: "canon_accepted", requiredGates: ["explicitCanonAcceptance"] },
    { to: "archived_without_acceptance", requiredGates: [] },
  ],
  canon_accepted: [],
  archived_without_acceptance: [],
}

const reviewStages: ReadonlySet<Stage> = new Set(["rough_outline_review", "detailed_outline_review", "prose_review"])

export const StageGraph = {
  canTransition(from: Stage, to: Stage, gates: StageGateInput = {}): true {
    const rule = transitionRules[from].find((candidate) => candidate.to === to)
    if (!rule) {
      throw new NovelError(NovelErrorCode.STAGE_TRANSITION_BLOCKED, `Cannot transition from ${from} to ${to}`)
    }

    for (const requiredGate of rule.requiredGates) {
      if (requiredGate === "reviewGate") {
        validateReviewGate(from, rule, gates)
        continue
      }

      if (requiredGate === "explicitCanonAcceptance") {
        if (!gates.explicitCanonAcceptance) {
          throw new NovelError(
            NovelErrorCode.CANON_ACCEPTANCE_REQUIRES_EXPLICIT_ACTION,
            "Canon acceptance requires an explicit accept_canon action"
          )
        }
        continue
      }

      if (!gates[requiredGate as keyof StageGateInput]) {
        throw new NovelError(NovelErrorCode.STAGE_TRANSITION_BLOCKED, `Missing required gate: ${requiredGate}`)
      }
    }

    return true
  },

  getNextStages(stage: Stage): Stage[] {
    return transitionRules[stage].map((rule) => rule.to)
  },

  getRequiredGates(stage: Stage): string[] {
    return Array.from(new Set(transitionRules[stage].flatMap((rule) => rule.requiredGates)))
  },
}

export const canTransition = StageGraph.canTransition
export const getNextStages = StageGraph.getNextStages
export const getRequiredGates = StageGraph.getRequiredGates

function validateReviewGate(from: Stage, rule: TransitionRule, gates: StageGateInput): void {
  if (!reviewStages.has(from) || !gates.reviewGate) {
    throw new NovelError(NovelErrorCode.REQUIRED_REVIEW_MISSING, "A fresh review artifact is required")
  }

  const review = gates.reviewGate.review
  validateReviewMatchesStageAndHash(review, from, gates.reviewGate.currentArtifactHash)

  if ((from === "rough_outline_review" || from === "detailed_outline_review") && rule.decision === "approved") {
    validateRequiredReviewGateSet(from, RequiredOutlineReviewGates, gates.reviewGateSet ?? { reviews: [review], currentArtifactHash: gates.reviewGate.currentArtifactHash })
    return
  }

  if (from === "prose_review" && rule.decision === "approved") {
    validateRequiredReviewGateSet(from, RequiredProseReviewGates, gates.reviewGateSet ?? { reviews: [review], currentArtifactHash: gates.reviewGate.currentArtifactHash })
    return
  }

  if (rule.decision && !reviewMatchesDecision(review, rule.decision)) {
    throw new NovelError(NovelErrorCode.STAGE_TRANSITION_BLOCKED, `Review decision ${review.decision} cannot transition to ${rule.to}`)
  }

  if (rule.decision === "approved" && review.status !== "pass") {
    throwReviewBlocksAdvancement(review)
  }

  if (rule.decision === "revision_required" && review.status === "pass") {
    throw new NovelError(NovelErrorCode.STAGE_TRANSITION_BLOCKED, `Review status ${review.status} cannot transition to ${rule.to}`)
  }
}

function validateRequiredReviewGateSet(from: Stage, requiredGates: readonly ReviewGateName[], gateSet: NonNullable<StageGateInput["reviewGateSet"]>): void {
  const currentByGate = new Map<ReviewGateName, ReviewResult[]>()
  for (const review of gateSet.reviews) {
    validateReviewMatchesStageAndHash(review, from, gateSet.currentArtifactHash)
    const reviews = currentByGate.get(review.gate) ?? []
    reviews.push(review)
    currentByGate.set(review.gate, reviews)
  }

  for (const gate of requiredGates) {
    const reviews = currentByGate.get(gate) ?? []
    if (reviews.length === 0) {
      throw new NovelError(NovelErrorCode.REQUIRED_REVIEW_MISSING, `Missing required review gate: ${gate}`)
    }

    const blockingReview = reviews.find((review) => review.status !== "pass" || review.severity === "blocking" || review.blockingIssues.length > 0)
    if (blockingReview) {
      throwReviewBlocksAdvancement(blockingReview)
    }
  }
}

function validateReviewMatchesStageAndHash(review: ReviewResult, from: Stage, currentArtifactHash: string): void {
  if (review.stage !== from as ReviewStage) {
    throw new NovelError(NovelErrorCode.REQUIRED_REVIEW_MISSING, `Review stage ${review.stage} does not match ${from}`)
  }

  if (isReviewStale(review, currentArtifactHash)) {
    throw new NovelError(NovelErrorCode.REVIEW_ARTIFACT_STALE, "Review artifact hash does not match current artifact hash")
  }
}

function throwReviewBlocksAdvancement(review: ReviewResult): never {
  if (review.status === "needs_user_input") {
    throw new NovelError(NovelErrorCode.STAGE_TRANSITION_BLOCKED, `Review gate ${review.gate} requires user input: ${review.reason}`)
  }

  const blockingIssue = review.blockingIssues[0]
  const reason = blockingIssue ? `${blockingIssue.issue} Suggested fix: ${blockingIssue.suggestedFix}` : review.reason
  throw new NovelError(NovelErrorCode.STAGE_TRANSITION_BLOCKED, `Review gate ${review.gate} blocks advancement: ${reason}`)
}

function reviewMatchesDecision(review: ReviewResult, decision: ReviewDecision): boolean {
  if (review.decision === decision) return true
  if (decision === "approved") return review.status === "pass"
  return review.status === "fail" || review.status === "needs_user_input"
}
