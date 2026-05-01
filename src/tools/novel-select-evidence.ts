import { tool } from "@opencode-ai/plugin"
import { StageSchema, type Stage } from "../schemas"
import { jsonResult, projectRoot, readEvidencePacks, requireCurrentRun } from "./common"

export function createNovelSelectEvidenceTool() {
  return tool({
    description: `Select evidence packs from the current run for context injection.

Use before drafting or reviewing when an agent needs grounded claims from corpus evidence packs.
Accepted inputs: optional stages filter and optional limit.
Outputs: matching EvidencePack artifacts from the fixed corpus/evidence-packs store.
Recovery: if no packs are returned, write valid evidence_pack artifacts and ensure their artifactIds are attached to current_run.`,
    args: {
      stages: tool.schema.array(tool.schema.string()).optional().describe("Optional run stages to include, such as prose_draft or event_selection."),
      limit: tool.schema.number().int().positive().max(50).optional().describe("Maximum evidence packs to return. Defaults to all matching packs up to 50."),
    },
    async execute(args, ctx) {
      const root = projectRoot(ctx)
      const run = await requireCurrentRun(root)
      const stages = args.stages?.map((stage) => StageSchema.parse(stage)) as Stage[] | undefined
      const packs = await readEvidencePacks(run, root, stages)
      return jsonResult({ evidencePacks: packs.slice(0, args.limit ?? 50), totalMatches: packs.length })
    },
  })
}
