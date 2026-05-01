import { tool } from "@opencode-ai/plugin"
import { initNovelProject } from "../storage"
import { ensureCurrentRun, jsonResult, projectRoot } from "./common"

export function createNovelInitProjectTool() {
  return tool({
    description: `Initialize the .novel project layout and default current run state.

Use when status reports initialized=false or a workflow needs project.json, canon, corpus, outline, run, draft, and log directories created.
Accepted inputs: none; the OpenCode session directory is used as project root.
Outputs: project summary and current run summary.
Recovery: if project.json is corrupt, inspect or repair .novel/project.json before retrying.`,
    args: {},
    async execute(_args, ctx) {
      const root = projectRoot(ctx)
      const project = await initNovelProject(root)
      const run = await ensureCurrentRun(root, project.projectId)
      return jsonResult({ initialized: true, project, currentRun: run })
    },
  })
}
