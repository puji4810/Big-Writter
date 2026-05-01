import { RequiredOutlineReviewGates, RequiredProseReviewGates, isReviewStale, type ReviewGateName, type ReviewResult, type ReviewStage } from "../schemas/review"
import type { RunState, Stage } from "../schemas/run"
import { getActiveDetailedOutlineArtifactId, readRunReviews } from "../tools/common"
import type { SpecialistAgentName } from "../orchestration/types"

const reviewerByGate: Record<ReviewGateName, SpecialistAgentName> = {
  "logic-world-motivation": "logic-world-motivation-reviewer",
  "prose-style-pacing": "prose-style-pacing-reviewer",
  continuity: "continuity-checker",
  "preference-boundary": "preference-boundary-checker",
}

const stageOrder: readonly Stage[] = [
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
]

export type ReviewSetValidation = {
  valid: boolean
  requiredGates: readonly ReviewGateName[]
  presentGates: ReviewGateName[]
  passingGates: ReviewGateName[]
  missingGates: ReviewGateName[]
  failingGates: ReviewGateName[]
  staleReviews: ReviewResult[]
  acceptedReviews: ReviewResult[]
}

export type AutoTriggeredReviewPlan = {
  stage: ReviewStage | null
  artifactId: string
  artifactHash: string
  requiredGates: readonly ReviewGateName[]
  missingReviewGates: ReviewGateName[]
  staleReviews: ReviewResult[]
  blockingReviews: ReviewResult[]
  dispatchedAgents: SpecialistAgentName[]
}

export async function autoTriggerReviews(
  run: RunState,
  artifactId: string,
  artifactHash: string,
  root: string,
): Promise<AutoTriggeredReviewPlan> {
  const stage = toReviewStage(run.stage)
  const requiredGates = getRequiredReviewGates(run.stage)
  if (!stage || requiredGates.length === 0) {
    return {
      stage: null,
      artifactId,
      artifactHash,
      requiredGates,
      missingReviewGates: [],
      staleReviews: [],
      blockingReviews: [],
      dispatchedAgents: [],
    }
  }

  const reviews = await readRunReviews(run, root)
  const relevantReviews = reviews.filter((review) => review.stage === stage && review.reviewedArtifactId === artifactId)
  const validation = validateReviewSet(relevantReviews, requiredGates, artifactHash)
  const completedFreshGates = new Set(validation.presentGates)
  const missingReviewGates = requiredGates.filter((gate) => !completedFreshGates.has(gate))

  return {
    stage,
    artifactId,
    artifactHash,
    requiredGates,
    missingReviewGates,
    staleReviews: validation.staleReviews,
    blockingReviews: relevantReviews.filter((review) => !isReviewStale(review, artifactHash) && isBlockingReview(review)),
    dispatchedAgents: selectReviewerAgents(missingReviewGates),
  }
}

export async function isProseAllowed(run: RunState, artifactHash: string, root: string): Promise<boolean> {
  if (!isStageAtOrBeyond(run.stage, "detailed_outline_review")) {
    return false
  }

  const artifactId = getActiveDetailedOutlineArtifactId(run)
  if (!artifactId) {
    return false
  }

  const reviews = await readRunReviews(run, root)
  const relevantReviews = reviews.filter(
    (review) => review.stage === "detailed_outline_review" && review.reviewedArtifactId === artifactId,
  )

  return validateReviewSet(relevantReviews, RequiredOutlineReviewGates, artifactHash).valid
}

export function validateReviewSet(
  reviews: ReviewResult[],
  requiredGates: readonly ReviewGateName[],
  artifactHash: string,
): ReviewSetValidation {
  const staleReviews = reviews.filter((review) => isReviewStale(review, artifactHash))
  const freshReviews = reviews.filter((review) => !isReviewStale(review, artifactHash))
  const acceptedReviews: ReviewResult[] = []
  const presentGates = new Set<ReviewGateName>()
  const passingGates = new Set<ReviewGateName>()
  const missingGates: ReviewGateName[] = []
  const failingGates: ReviewGateName[] = []

  for (const gate of requiredGates) {
    const gateReviews = freshReviews.filter((review) => review.gate === gate)
    if (gateReviews.length === 0) {
      missingGates.push(gate)
      continue
    }

    presentGates.add(gate)
    const gateHasBlockingReview = gateReviews.some(isBlockingReview)
    if (gateHasBlockingReview) {
      failingGates.push(gate)
      continue
    }

    passingGates.add(gate)
    acceptedReviews.push(...gateReviews)
  }

  return {
    valid: missingGates.length === 0 && failingGates.length === 0 && staleReviews.length === 0,
    requiredGates,
    presentGates: [...presentGates],
    passingGates: [...passingGates],
    missingGates,
    failingGates,
    staleReviews,
    acceptedReviews,
  }
}

export async function invalidateStaleReviews(
  run: RunState,
  newHash: string,
  root: string,
): Promise<ReviewResult[]> {
  const artifactId = getActiveDetailedOutlineArtifactId(run)
  if (!artifactId) {
    return []
  }

  const reviews = await readRunReviews(run, root)
  return reviews.filter(
    (review) => review.stage === "detailed_outline_review" && review.reviewedArtifactId === artifactId && isReviewStale(review, newHash),
  )
}

function getRequiredReviewGates(stage: Stage): readonly ReviewGateName[] {
  if (stage === "rough_outline_review" || stage === "detailed_outline_review") {
    return RequiredOutlineReviewGates
  }

  if (stage === "prose_review") {
    return RequiredProseReviewGates
  }

  return []
}

function toReviewStage(stage: Stage): ReviewStage | null {
  if (stage === "rough_outline_review" || stage === "detailed_outline_review" || stage === "prose_review") {
    return stage
  }

  return null
}

function isStageAtOrBeyond(stage: Stage, minimumStage: Stage): boolean {
  return stageOrder.indexOf(stage) >= stageOrder.indexOf(minimumStage)
}

function selectReviewerAgents(gates: readonly ReviewGateName[]): SpecialistAgentName[] {
  return gates.map((gate) => reviewerByGate[gate])
}

function isBlockingReview(review: ReviewResult): boolean {
  return review.status !== "pass" || review.severity === "blocking" || review.blockingIssues.length > 0
}
