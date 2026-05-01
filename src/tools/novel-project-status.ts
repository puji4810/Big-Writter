import { tool } from "@opencode-ai/plugin"
import { jsonResult, projectRoot, statusPayload } from "./common"

export function createNovelProjectStatusTool() {
  return tool({
    description: `Return novel project initialization and run status.

Use when an agent needs to know whether .novel exists, what stage the current run is in, or what gates may be required before the next transition.
Accepted inputs: none.
Outputs: initialized boolean, current run state when available, current stage, and pending gate names. If not initialized, returns nextAction with /novel-start or novel_init_project.
Recovery: if initialized is false, call novel_init_project before reading or writing run artifacts.`,
    args: {},
    async execute(_args, ctx) {
      return jsonResult(await statusPayload(projectRoot(ctx)))
    },
  })
}
