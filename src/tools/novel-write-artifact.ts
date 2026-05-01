import { tool } from "@opencode-ai/plugin"
import { writeArtifact, type NovelArtifact } from "../storage"
import { ArtifactPayloadSchema, ArtifactReferenceSchema, addRunArtifact, artifactPath, assertKnownPayloadMatchesReference, jsonResult, projectRoot, readCurrentRun, writeCurrentRun } from "./common"

export function createNovelWriteArtifactTool() {
  return tool({
    description: `Write a schema-validated novel artifact to a fixed .novel location.

Use when an agent has produced a review result, evidence pack, canon fact set, or preference boundary profile that should be persisted.
Accepted inputs: artifact selector plus payload validated by the existing schemas; arbitrary file paths are not accepted.
Outputs: written path, artifact id when present, and whether current run artifactIds were updated.
Recovery: fix schema validation errors in payload or initialize the project before retrying.`,
    args: {
      artifact: tool.schema.unknown().describe("Artifact selector matching the fixed artifact reference schema."),
      payload: tool.schema.unknown().describe("Artifact payload matching one existing novel schema."),
    },
    async execute(args, ctx) {
      const root = projectRoot(ctx)
      const reference = ArtifactReferenceSchema.parse(args.artifact)
      const payload = ArtifactPayloadSchema.parse(args.payload) as NovelArtifact
      assertKnownPayloadMatchesReference(reference, payload)
      const path = artifactPath(reference)
      await writeArtifact(path, payload, root)
      const artifactId = "artifactId" in payload ? payload.artifactId : "profileId" in payload ? payload.profileId : undefined
      const run = await readCurrentRun(root)
      const updatedRun = run && artifactId ? addRunArtifact(run, artifactId) : null
      if (updatedRun) {
        await writeCurrentRun(updatedRun, root)
      }
      return jsonResult({ written: true, path, artifactId, currentRunUpdated: Boolean(updatedRun) })
    },
  })
}
