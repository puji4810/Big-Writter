import { tool } from "@opencode-ai/plugin"
import { ReviewResultSchema, type ReviewResult, type RunState } from "../schemas"
import { writeArtifact } from "../storage"
import { addRunArtifact, artifactPath, jsonResult, projectRoot, requireCurrentRun, writeCurrentRun } from "./common"

export async function recordReviewArtifact(review: ReviewResult, root: string, run?: RunState): Promise<RunState> {
  const currentRun = run ?? await requireCurrentRun(root)
  const path = artifactPath({ kind: "review", artifactId: review.artifactId })
  await writeArtifact(path, review, root)
  const updatedRun = addRunArtifact(currentRun, review.artifactId)
  await writeCurrentRun(updatedRun, root)
  return updatedRun
}

export function createNovelRecordReviewTool() {
  return tool({
    description: `Record a schema-valid review result for the current run.

Use after a reviewer agent completes rough outline, detailed outline, or prose review.
Accepted inputs: review object matching ReviewResultSchema, including gate, status, severity, blockingIssues, nonBlockingSuggestions, affectedArtifactIds, artifactHash, reason, suggestedFix, and requiresUserDecision.
Outputs: stored review path, artifact id, gate, status, and updated current run.
Recovery: if validation fails, correct review stage, gate, status, reviewed hash, artifact hash, version, or reviewer metadata before retrying.`,
    args: {
      review: tool.schema.unknown().describe("Review result matching ReviewResultSchema."),
    },
    async execute(args, ctx) {
      const root = projectRoot(ctx)
      const review = ReviewResultSchema.parse(args.review)
      const updatedRun = await recordReviewArtifact(review, root)
      const path = artifactPath({ kind: "review", artifactId: review.artifactId })
      return jsonResult({ recorded: true, path, artifactId: review.artifactId, gate: review.gate, status: review.status, decision: review.decision, currentRun: updatedRun })
    },
  })
}
