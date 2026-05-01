import { tool } from "@opencode-ai/plugin"
import { NovelError, NovelErrorCode } from "../errors"
import { jsonResult, projectRoot, requireCurrentRun, updateRunStage, writeCurrentRun } from "./common"

export function createNovelArchiveRunTool() {
  return tool({
    description: `Archive the current run without accepting its findings into canon.

Use when a draft has been rejected or a run should be terminated without canon mutation.
Outputs: current run advanced to archived_without_acceptance.`,
    args: {},
    async execute(_args, ctx) {
      const root = projectRoot(ctx)
      const run = await requireCurrentRun(root)
      
      const updatedRun = updateRunStage(run, "archived_without_acceptance")
      await writeCurrentRun(updatedRun, root)
      
      return jsonResult({
        archived: true,
        currentRun: updatedRun,
      })
    },
  })
}
