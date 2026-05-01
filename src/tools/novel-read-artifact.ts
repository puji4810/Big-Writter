import { tool } from "@opencode-ai/plugin"
import { readArtifact } from "../storage"
import { ArtifactReferenceSchema, artifactPath, jsonResult, projectRoot } from "./common"

export function createNovelReadArtifactTool() {
  return tool({
    description: `Read a typed novel artifact from a fixed .novel location.

Use when an agent needs project, current_run, review, evidence_pack, canon_fact_set, boundary_profile, outline, draft, or interview data.
Accepted inputs: artifact selector with kind and artifactId for multi-artifact collections; arbitrary paths are rejected.
Outputs: the schema-validated artifact returned by storage.readArtifact().
Recovery: if the artifact is missing or corrupt, call novel_project_status and then write a valid schema artifact with novel_write_artifact.`,
    args: {
      artifact: tool.schema.unknown().describe("Artifact selector matching the fixed artifact reference schema."),
    },
    async execute(args, ctx) {
      const reference = ArtifactReferenceSchema.parse(args.artifact)
      const artifact = await readArtifact(artifactPath(reference), projectRoot(ctx))
      return jsonResult({ artifact })
    },
  })
}
