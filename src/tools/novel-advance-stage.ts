import { tool } from "@opencode-ai/plugin"
import { StageGraph } from "../stage-graph"
import { StageGateInputSchema, StageSchema } from "../schemas"
import { assertInitialized, jsonResult, projectRoot, requireCurrentRun, updateRunStage, writeCurrentRun } from "./common"
import { INTERVIEW_ADVANCEMENT_GATE_GUIDANCE } from "../prompts/artifact-guidance"

export function createNovelAdvanceStageTool() {
  return tool({
    description: `Advance the current run to a requested stage after StageGraph validation.

Use only when the workflow is ready to move stages and required gates are available.
Accepted inputs: target stage and optional gates matching StageGateInputSchema, including reviewGate, reviewGateSet, or explicitCanonAcceptance where required. Advancing prose_review to draft_ready requires passing logic-world-motivation, prose-style-pacing, continuity, and preference-boundary reviews for the current artifact hash.

${INTERVIEW_ADVANCEMENT_GATE_GUIDANCE}

Outputs: previous stage, next stage, and updated current run.
Recovery: on ERR_STAGE_TRANSITION_BLOCKED or missing gate errors, gather the required artifact or review and retry; this tool never auto-advances.`,
    args: {
      to: tool.schema.string().describe("Target stage from StageSchema."),
      gates: tool.schema.unknown().optional().describe("Optional gates matching StageGateInputSchema."),
    },
    async execute(args, ctx) {
      const root = projectRoot(ctx)
      assertInitialized(root)
      const run = await requireCurrentRun(root)
      const to = StageSchema.parse(args.to)
      const gates = args.gates === undefined ? {} : StageGateInputSchema.parse(args.gates)
      StageGraph.canTransition(run.stage, to, gates)
      const updatedRun = updateRunStage(run, to)
      await writeCurrentRun(updatedRun, root)
      return jsonResult({ advanced: true, from: run.stage, to, currentRun: updatedRun })
    },
  })
}
