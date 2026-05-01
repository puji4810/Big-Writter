import { z } from "zod"

export const SCHEMA_VERSION = "1.0.0"

export const StageSchema = z.enum([
  "uninitialized",
  "interviewing",
  "rough_outline_draft",
  "rough_outline_review",
  "rough_outline_revision_required",
  "detailed_outline_draft",
  "detailed_outline_review",
  "detailed_outline_revision_required",
  "event_selection",
  "prose_draft",
  "prose_review",
  "prose_revision_required",
  "draft_ready",
  "canon_acceptance_pending",
  "canon_accepted",
  "archived_without_acceptance",
])

export const ArtifactStatusSchema = z.enum([
  "draft",
  "ready_for_review",
  "approved",
  "revision_required",
  "accepted",
  "archived",
])

export const RunArtifactBaseSchema = z.object({
  schemaVersion: z.string().min(1),
  artifactId: z.string().min(1),
  runId: z.string().min(1),
  createdAt: z.string().datetime(),
  stage: StageSchema,
  sourceArtifactIds: z.array(z.string().min(1)),
  status: ArtifactStatusSchema,
}).strict()

export const RunStateSchema = z.object({
  schemaVersion: z.string().min(1),
  runId: z.string().min(1),
  projectId: z.string().min(1),
  stage: StageSchema,
  artifactIds: z.array(z.string().min(1)),
  updatedAt: z.string().datetime(),
}).strict()

export type Stage = z.infer<typeof StageSchema>
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>
export type RunArtifactBase = z.infer<typeof RunArtifactBaseSchema>
export type RunState = z.infer<typeof RunStateSchema>
