import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { ToolContext, ToolResult } from "@opencode-ai/plugin"
import { NovelError, NovelErrorCode } from "../errors"
import {
  CanonFactSetSchema,
  DraftArtifactSchema,
  EvidencePackSchema,
  InterviewArtifactSchema,
  PreferenceBoundaryProfileSchema,
  ReviewResultSchema,
  RoughOutlineArtifactSchema,
  DetailedOutlineArtifactSchema,
  RunStateSchema,
  SCHEMA_VERSION,
  StageGateInputSchema,
  StageSchema,
  type CanonFactSet,
  type EvidencePack,
  type PreferenceBoundaryProfile,
  type ReviewResult,
  type RunState,
  type Stage,
} from "../schemas"
import { projectExists, readArtifact, writeArtifact, type NovelArtifact } from "../storage"

export const CURRENT_RUN_PATH = "runs/current.json"
export const BOUNDARY_PROFILE_PATH = "preferences/boundaries.json"

export const ARTIFACT_PATHS = {
  project: "project.json",
  current_run: CURRENT_RUN_PATH,
  boundary_profile: BOUNDARY_PROFILE_PATH,
} as const

export const ArtifactReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project") }).strict(),
  z.object({ kind: z.literal("current_run") }).strict(),
  z.object({ kind: z.literal("boundary_profile") }).strict(),
  z.object({ kind: z.literal("review"), artifactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("evidence_pack"), artifactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("canon_fact_set"), artifactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("rough_outline"), artifactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("detailed_outline"), artifactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("draft"), artifactId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("interview"), artifactId: z.string().min(1) }).strict(),
]).describe("Artifact selector. Use a fixed kind plus artifactId when the kind stores multiple artifacts; arbitrary filesystem paths are not accepted.")

export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>

export const ArtifactPayloadSchema = z.union([
  EvidencePackSchema,
  PreferenceBoundaryProfileSchema,
  ReviewResultSchema,
  CanonFactSetSchema,
  InterviewArtifactSchema,
  RoughOutlineArtifactSchema,
  DetailedOutlineArtifactSchema,
  DraftArtifactSchema,
]).describe("Known writable artifact payload validated against the novel schemas.")

export function projectRoot(ctx: ToolContext): string {
  return ctx.directory
}

export function jsonResult(value: unknown): ToolResult {
  return {
    output: JSON.stringify(value, null, 2),
    metadata: { result: value },
  }
}

export function artifactPath(reference: ArtifactReference): string {
  switch (reference.kind) {
    case "project":
      return ARTIFACT_PATHS.project
    case "current_run":
      return ARTIFACT_PATHS.current_run
    case "boundary_profile":
      return ARTIFACT_PATHS.boundary_profile
    case "review":
      return `reviews/${reference.artifactId}.json`
    case "evidence_pack":
      return `corpus/evidence-packs/${reference.artifactId}.json`
    case "canon_fact_set":
      return `canon/${reference.artifactId}.json`
    case "rough_outline":
      return `outlines/rough/${reference.artifactId}.json`
    case "detailed_outline":
      return `outlines/detailed/${reference.artifactId}.json`
    case "draft":
      return `drafts/${reference.artifactId}.json`
    case "interview":
      return `interviews/${reference.artifactId}.json`
  }
}

export async function readCurrentRun(root: string): Promise<RunState | null> {
  try {
    const artifact = await readArtifact(CURRENT_RUN_PATH, root)
    return RunStateSchema.parse(artifact)
  } catch (error) {
    if (error instanceof NovelError && error.code === NovelErrorCode.ARTIFACT_CORRUPT && error.message.includes(CURRENT_RUN_PATH)) {
      return null
    }
    throw error
  }
}

export async function requireCurrentRun(root: string): Promise<RunState> {
  const run = await readCurrentRun(root)
  if (!run) {
    throw new NovelError(NovelErrorCode.PROJECT_NOT_INITIALIZED, `Current run state is missing at ${CURRENT_RUN_PATH}`)
  }
  return run
}

export async function writeCurrentRun(run: RunState, root: string): Promise<void> {
  await writeArtifact(CURRENT_RUN_PATH, RunStateSchema.parse(run), root)
}

export async function ensureCurrentRun(root: string, projectId: string): Promise<RunState> {
  const current = await readCurrentRun(root)
  if (current) {
    return current
  }

  const now = new Date().toISOString()
  const run = RunStateSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    runId: randomUUID(),
    projectId,
    stage: "uninitialized",
    artifactIds: [],
    updatedAt: now,
  })
  await writeCurrentRun(run, root)
  return run
}

export function updateRunStage(run: RunState, stage: Stage): RunState {
  return RunStateSchema.parse({ ...run, stage, updatedAt: new Date().toISOString() })
}

export function addRunArtifact(run: RunState, artifactId: string): RunState {
  const artifactIds = run.artifactIds.includes(artifactId) ? run.artifactIds : [...run.artifactIds, artifactId]
  return RunStateSchema.parse({ ...run, artifactIds, updatedAt: new Date().toISOString() })
}

export async function readRunReviews(run: RunState, root: string): Promise<ReviewResult[]> {
  const reviews: ReviewResult[] = []
  for (const artifactId of run.artifactIds) {
    try {
      const artifact = await readArtifact(artifactPath({ kind: "review", artifactId }), root)
      const parsed = ReviewResultSchema.safeParse(artifact)
      if (parsed.success) {
        reviews.push(parsed.data)
      }
    } catch (error) {
      if (error instanceof NovelError && error.code === NovelErrorCode.ARTIFACT_CORRUPT) {
        continue
      }
      throw error
    }
  }
  return reviews
}

export async function readEvidencePacks(run: RunState, root: string, stages?: Stage[]): Promise<EvidencePack[]> {
  const packs: EvidencePack[] = []
  for (const artifactId of run.artifactIds) {
    try {
      const artifact = await readArtifact(artifactPath({ kind: "evidence_pack", artifactId }), root)
      const parsed = EvidencePackSchema.safeParse(artifact)
      if (parsed.success && (!stages || stages.includes(parsed.data.stage))) {
        packs.push(parsed.data)
      }
    } catch (error) {
      if (error instanceof NovelError && error.code === NovelErrorCode.ARTIFACT_CORRUPT) {
        continue
      }
      throw error
    }
  }
  return packs
}

export async function statusPayload(root: string): Promise<Record<string, unknown>> {
  if (!projectExists(root)) {
    return { initialized: false, nextAction: "/novel-start or novel_init_project" }
  }

  const run = await readCurrentRun(root)
  const stage = run?.stage ?? "uninitialized"
  return {
    initialized: true,
    currentRun: run,
    currentStage: stage,
    pendingGates: StageGateInputSchema.keyof().options.filter((gate) => gate !== "reviewGate" || stage.endsWith("_review")),
  }
}

export function assertStage(value: Stage): Stage {
  return StageSchema.parse(value)
}

export function isReviewFreshForAcceptedHash(review: ReviewResult, acceptedArtifactHash: string): boolean {
  return review.artifactHash === acceptedArtifactHash && review.reviewedArtifactHash === acceptedArtifactHash
}

export function assertInitialized(root: string): void {
  if (!projectExists(root)) {
    throw new NovelError(NovelErrorCode.PROJECT_NOT_INITIALIZED, `Novel project is not initialized at ${root}/.novel`)
  }
}

export function assertKnownPayloadMatchesReference(reference: ArtifactReference, payload: NovelArtifact): void {
  const accepted = new Set<string>()
  switch (reference.kind) {
    case "review":
      accepted.add("review")
      if (!ReviewResultSchema.safeParse(payload).success) throwMismatch(reference.kind)
      return
    case "evidence_pack":
      if (!EvidencePackSchema.safeParse(payload).success) throwMismatch(reference.kind)
      return
    case "canon_fact_set":
      if (!CanonFactSetSchema.safeParse(payload).success) throwMismatch(reference.kind)
      return
    case "draft":
      if (!DraftArtifactSchema.safeParse(payload).success) throwMismatch(reference.kind)
      return
    case "rough_outline":
      if (!RoughOutlineArtifactSchema.safeParse(payload).success) throwMismatch(reference.kind)
      return
    case "detailed_outline":
      if (!DetailedOutlineArtifactSchema.safeParse(payload).success) throwMismatch(reference.kind)
      return
    case "interview":
      if (!InterviewArtifactSchema.safeParse(payload).success) throwMismatch(reference.kind)
      return
    case "boundary_profile":
      if (!PreferenceBoundaryProfileSchema.safeParse(payload).success) throwMismatch(reference.kind)
      return
    default:
      void accepted
      return
  }
}

function throwMismatch(kind: ArtifactReference["kind"]): never {
  throw new NovelError(NovelErrorCode.ARTIFACT_CORRUPT, `Payload does not match ${kind} artifact schema`)
}

export function getActiveRoughOutlineArtifactId(run: RunState): string | null {
  return run.activeRoughOutline?.artifactId ?? null
}

export function getActiveDetailedOutlineArtifactId(run: RunState): string | null {
  return run.activeDetailedOutline?.artifactId ?? null
}

export function getActiveProseArtifactId(run: RunState): string | null {
  return run.activeProseSelection?.artifactId ?? null
}

export function getActiveCharacterCompilation(run: RunState): RunState["activeCharacterCompilation"] {
  return run.activeCharacterCompilation ?? null
}

export function isRunUpgraded(run: RunState): boolean {
  return (
    run.activeRoughOutline !== undefined ||
    run.activeDetailedOutline !== undefined ||
    run.activeProseSelection !== undefined ||
    run.activeCharacterCompilation !== undefined
  )
}
