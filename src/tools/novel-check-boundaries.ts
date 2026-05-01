import { tool } from "@opencode-ai/plugin"
import { PreferenceBoundaryProfileSchema } from "../schemas"
import { readArtifact } from "../storage"
import { BOUNDARY_PROFILE_PATH, jsonResult, projectRoot } from "./common"

export function createNovelCheckBoundariesTool() {
  return tool({
    description: `Check content against the stored preference boundary profile.

Use before prose or outline output is treated as ready for review.
Accepted inputs: content string and optional profile override; by default reads preferences/boundaries.json.
Outputs: violation list for hard boundaries and avoided content plus pass/fail boolean.
Recovery: revise content to remove reported terms or update the boundary profile through novel_write_artifact if preferences changed.`,
    args: {
      content: tool.schema.string().min(1).describe("Content to check against preference boundaries."),
      profile: tool.schema.unknown().optional().describe("Optional boundary profile override; otherwise the stored profile is read."),
    },
    async execute(args, ctx) {
      const root = projectRoot(ctx)
      const profile = args.profile === undefined
        ? PreferenceBoundaryProfileSchema.parse(await readArtifact(BOUNDARY_PROFILE_PATH, root))
        : PreferenceBoundaryProfileSchema.parse(args.profile)
      const content = args.content.toLowerCase()
      const hardBoundaryViolations = profile.hardBoundaries.filter((boundary) => content.includes(boundary.toLowerCase()))
      const avoidedContentMatches = profile.avoidedContent.filter((boundary) => content.includes(boundary.toLowerCase()))
      return jsonResult({
        passed: hardBoundaryViolations.length === 0,
        hardBoundaryViolations,
        avoidedContentMatches,
        profileId: profile.profileId,
      })
    },
  })
}
