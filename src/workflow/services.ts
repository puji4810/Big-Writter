import { writeArtifact } from "../storage"
import { NovelError, NovelErrorCode } from "../errors"
import { artifactPath, addRunArtifact, writeCurrentRun } from "../tools/common"
import { buildProvenanceMeta, resolveActiveDetailedOutline } from "../orchestration/provenance"
import {
  createDraftFromApprovedEvent,
} from "./builders"
import { compileRichDetailedOutline, compileRichRoughOutline } from "./outline-compiler"
import type { CompileOutlineOptions, DraftFromEventOptions } from "./builders"
import type { RunState, RoughOutlineArtifact, DetailedOutlineArtifact, DraftArtifact } from "../schemas"
import { autoTriggerReviews, isProseAllowed } from "./review-orchestrator"
import { recordAutoTriggeredReviews } from "./review-harness"
import { SCHEMA_VERSION } from "../schemas"
import { computeArtifactHash } from "../schemas/review"
import { randomUUID } from "node:crypto"

export async function compileAndStoreRoughOutline(
  markdown: string,
  run: RunState,
  options: CompileOutlineOptions,
  root: string,
): Promise<RoughOutlineArtifact> {
  const richOutline = compileRichRoughOutline(markdown, run, options)
  const artifact = buildRoughOutlineArtifact(markdown, richOutline, run, options)
  await writeArtifact(artifactPath({ kind: "rough_outline", artifactId: artifact.artifactId }), artifact, root)
  const provenance = buildProvenanceMeta({
    sourcePath: options.sourcePath,
    markdownContent: markdown,
    templateVersion: options.templateVersion ?? "1.0.0",
  })
  const updatedRun = {
    ...addRunArtifact(run, artifact.artifactId),
    stage: "rough_outline_review",
    activeRoughOutline: {
      artifactId: artifact.artifactId,
      markdownPath: provenance.sourcePath,
      markdownHash: provenance.markdownHash,
      templateVersion: provenance.templateVersion,
      compiledAt: provenance.compiledAt,
      syncStatus: "clean",
    },
  } satisfies RunState
  await writeCurrentRun(updatedRun, root)
  const reviewPlan = await autoTriggerReviews(updatedRun, artifact.artifactId, artifact.contentHash, root)
  await recordAutoTriggeredReviews(updatedRun, reviewPlan, root, { artifactVersion: artifact.version })
  return artifact
}

export async function compileAndStoreDetailedOutline(
  markdown: string,
  run: RunState,
  options: CompileOutlineOptions,
  root: string,
): Promise<DetailedOutlineArtifact> {
  const richOutline = compileRichDetailedOutline(markdown, run, options)
  const artifact = buildDetailedOutlineArtifact(markdown, richOutline, run, options)
  await writeArtifact(artifactPath({ kind: "detailed_outline", artifactId: artifact.artifactId }), artifact, root)
  const provenance = buildProvenanceMeta({
    sourcePath: options.sourcePath,
    markdownContent: markdown,
    templateVersion: options.templateVersion ?? "1.0.0",
  })
  const updatedRun = {
    ...addRunArtifact(run, artifact.artifactId),
    stage: "detailed_outline_review",
    activeDetailedOutline: {
      artifactId: artifact.artifactId,
      markdownPath: provenance.sourcePath,
      markdownHash: provenance.markdownHash,
      templateVersion: provenance.templateVersion,
      compiledAt: provenance.compiledAt,
      syncStatus: "clean",
    },
  } satisfies RunState
  await writeCurrentRun(updatedRun, root)
  const reviewPlan = await autoTriggerReviews(updatedRun, artifact.artifactId, artifact.contentHash, root)
  await recordAutoTriggeredReviews(updatedRun, reviewPlan, root, { artifactVersion: artifact.version })
  return artifact
}

export async function createAndStoreDraft(
  prose: string,
  run: RunState,
  eventRef: string,
  options: DraftFromEventOptions,
  root: string,
): Promise<DraftArtifact> {
  const activeDetailedOutline = await resolveActiveDetailedOutline(run, root)
  const activeDetailedOutlineHash = activeDetailedOutline?.contentHash ?? run.activeDetailedOutline?.markdownHash
  const proseAllowed = activeDetailedOutlineHash ? await isProseAllowed(run, activeDetailedOutlineHash, root) : false
  if (!proseAllowed) {
    throw new NovelError(
      NovelErrorCode.STAGE_TRANSITION_BLOCKED,
      "Detailed outline approval is required before prose drafting can begin.",
    )
  }

  const artifact = createDraftFromApprovedEvent(prose, run, eventRef, options)
  await writeArtifact(artifactPath({ kind: "draft", artifactId: artifact.artifactId }), artifact, root)
  const updatedRun = {
    ...addRunArtifact(run, artifact.artifactId),
    activeProseSelection: {
      artifactId: artifact.artifactId,
      eventReference: eventRef,
    },
  } satisfies RunState
  await writeCurrentRun(updatedRun, root)
  return artifact
}

function buildRoughOutlineArtifact(
  markdown: string,
  richOutline: ReturnType<typeof compileRichRoughOutline>,
  run: RunState,
  options: CompileOutlineOptions,
): RoughOutlineArtifact {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId: randomUUID(),
    runId: run.runId,
    createdAt: new Date().toISOString(),
    stage: "rough_outline_draft",
    sourceArtifactIds: options.sourceArtifactIds ?? [],
    status: options.status ?? "draft",
    logline: richOutline.premiseLogline,
    acts: richOutline.acts.map((act) => ({
      title: act.title,
      summary: `Goals: ${act.goals}\nStakes: ${act.stakes}\nKey Events: ${act.keyEvents}`,
      goals: act.goals,
      stakes: act.stakes,
      keyEvents: act.keyEvents,
      keyEventsList: act.keyEventsList,
    })),
    arcIntent: richOutline.arcIntent,
    coreConflicts: richOutline.coreConflicts,
    worldAssumptions: richOutline.worldAssumptions,
    protagonistEmotionalTrajectory: richOutline.protagonistEmotionalTrajectory,
    contentHash: computeArtifactHash(markdown),
    version: options.version ?? 1,
  }
}

function buildDetailedOutlineArtifact(
  markdown: string,
  richOutline: ReturnType<typeof compileRichDetailedOutline>,
  run: RunState,
  options: CompileOutlineOptions,
): DetailedOutlineArtifact {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId: randomUUID(),
    runId: run.runId,
    createdAt: new Date().toISOString(),
    stage: "detailed_outline_draft",
    sourceArtifactIds: options.sourceArtifactIds ?? [],
    status: options.status ?? "draft",
    chapters: richOutline.chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      synopsis: chapter.synopsis,
      keyEvents: chapter.keyEventsList,
      goal: chapter.goal,
      povFocus: chapter.povFocus,
      setupPayoff: chapter.setupPayoff,
      conflictEscalation: chapter.conflictEscalation,
      worldCanonDependencies: chapter.worldCanonDependencies,
      characterMotivationBeats: chapter.characterMotivationBeats,
      endingHook: chapter.endingHook,
      continuityHooks: chapter.continuityHooks,
    })),
    contentHash: computeArtifactHash(markdown),
    version: options.version ?? 1,
  }
}
