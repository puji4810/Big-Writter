import { tool } from "@opencode-ai/plugin"
import { writeArtifact, type NovelArtifact } from "../storage"
import { ArtifactPayloadSchema, ArtifactReferenceSchema, addRunArtifact, artifactPath, assertKnownPayloadMatchesReference, jsonResult, projectRoot, readCurrentRun, writeCurrentRun } from "./common"
import { buildArtifactPayloadGuidance, WRITABLE_ARTIFACT_KINDS, RUN_ARTIFACT_BASE_FIELDS } from "../prompts/artifact-guidance"

export function createNovelWriteArtifactTool() {
  return tool({
    description: `Write a schema-validated novel artifact to a fixed .novel location using an artifact reference (selector) and validated body payload. Supported artifact kinds: ${WRITABLE_ARTIFACT_KINDS.join(", ")}, and others.

${buildArtifactPayloadGuidance()}

Outputs: written path, artifact id when present, and whether current run artifactIds were updated.
Recovery: fix schema validation errors in payload or initialize the project before retrying.`,
    args: {
      artifact: tool.schema.unknown().describe("Artifact SELECTOR. Use { kind: \"kind\", artifactId: \"id\" } for run artifacts or { kind: \"boundary_profile\" } for preferences. This is the reference/look-up key, NOT the payload body."),
      payload: tool.schema.unknown().describe("Strict schema-validated artifact body. Must match the schema for the declared artifact kind. No extra top-level keys allowed. See tool description for per-kind field inventories."),
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
