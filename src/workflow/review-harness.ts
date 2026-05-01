import { randomUUID } from "node:crypto"
import { SCHEMA_VERSION, type ReviewGateName, type ReviewResult, type RunState, type ReviewStage } from "../schemas"
import type { AutoTriggeredReviewPlan } from "./review-orchestrator"
import { recordReviewArtifact } from "../tools/novel-record-review"

type RecordAutoReviewsOptions = {
  artifactVersion: number
}

export async function recordAutoTriggeredReviews(
  run: RunState,
  plan: AutoTriggeredReviewPlan,
  root: string,
  options: RecordAutoReviewsOptions,
): Promise<ReviewResult[]> {
  if (!plan.stage) {
    return []
  }

  const stage = plan.stage

  const reviews = plan.missingReviewGates.map((gate) =>
    buildPendingReview(run, stage, plan, gate, options.artifactVersion),
  )

  let currentRun = run
  for (const review of reviews) {
    currentRun = await recordReviewArtifact(review, root, currentRun)
  }

  return reviews
}

function buildPendingReview(
  run: RunState,
  stage: ReviewStage,
  plan: AutoTriggeredReviewPlan,
  gate: ReviewGateName,
  artifactVersion: number,
): ReviewResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId: randomUUID(),
    runId: run.runId,
    createdAt: new Date().toISOString(),
    stage,
    sourceArtifactIds: [plan.artifactId],
    status: "needs_user_input",
    gate,
    severity: "warning",
    blockingIssues: [],
    nonBlockingSuggestions: [
      `Auto-triggered ${gate} review is pending specialist completion.`,
    ],
    affectedArtifactIds: [plan.artifactId],
    artifactHash: plan.artifactHash,
    reason: `Auto-triggered ${gate} review has been queued for the current outline artifact.`,
    suggestedFix: "Complete the specialist review and replace this pending record with a final review result.",
    requiresUserDecision: true,
    reviewedArtifactId: plan.artifactId,
    reviewedArtifactHash: plan.artifactHash,
    reviewedArtifactVersion: artifactVersion,
    decision: "revision_required",
    deltas: [
      {
        path: gate,
        issue: `Pending ${gate} review has not been finalized yet.`,
        recommendation: "Run the specialist reviewer and store the final result for this artifact hash.",
      },
    ],
    reviewerId: `${gate}-auto-harness`,
  }
}
