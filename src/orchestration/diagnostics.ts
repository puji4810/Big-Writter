import { readdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { AUTHORED_DIR } from "../authoring/types"
import { INGEST_CHUNKS_DIR } from "../ingest/types"
import { RequiredOutlineReviewGates, RequiredProseReviewGates, isReviewStale, type ReviewGateName, type ReviewResult, type ReviewStage } from "../schemas/review"
import type { RunState, Stage } from "../schemas/run"
import { getActiveDetailedOutlineArtifactId, getActiveRoughOutlineArtifactId, getActiveProseArtifactId, readRunReviews } from "../tools/common"
import { evaluate } from "./dispatcher"
import type { ActiveArtifactsMap, PolicyDecision, PolicyInput, ReviewStatusMap, SpecialistAgentName } from "./types"

export interface DispatchLogEntry {
  timestamp: string
  input: PolicyInput
  decision: PolicyDecision
}

let dispatchLog: DispatchLogEntry[] = []

export function recordDispatch(input: PolicyInput, decision: PolicyDecision): void {
  dispatchLog.push({
    timestamp: new Date().toISOString(),
    input,
    decision,
  })
}

export function evaluateWithDiagnostics(input: PolicyInput): PolicyDecision {
  const decision = evaluate(input)
  recordDispatch(input, decision)
  return decision
}

export function dumpDispatchLog(): DispatchLogEntry[] {
  return [...dispatchLog]
}

export function clearDispatchLog(): void {
  dispatchLog = []
}

export interface ActiveArtifactsDump {
  stage: Stage
  roughOutline: { artifactId: string | null; markdownPath: string | null; markdownHash: string | null; syncStatus: string | null }
  detailedOutline: { artifactId: string | null; markdownPath: string | null; markdownHash: string | null; syncStatus: string | null }
  proseSelection: { artifactId: string | null; eventReference: string | null }
  characterCompilation: { markdownPath: string | null; fileCount: number | null }
  activeArtifactMap: ActiveArtifactsMap
}

export function dumpActiveArtifacts(run: RunState): ActiveArtifactsDump {
  const activeArtifactMap: ActiveArtifactsMap = {}

  if (run.activeRoughOutline) {
    activeArtifactMap.rough_outline = [{ id: run.activeRoughOutline.artifactId, kind: "rough_outline", format: "markdown" }]
  }
  if (run.activeDetailedOutline) {
    activeArtifactMap.detailed_outline = [{ id: run.activeDetailedOutline.artifactId, kind: "detailed_outline", format: "markdown" }]
  }
  if (run.activeProseSelection) {
    activeArtifactMap.prose = [{ id: run.activeProseSelection.artifactId, kind: "prose", format: "text" }]
  }

  return {
    stage: run.stage,
    roughOutline: {
      artifactId: run.activeRoughOutline?.artifactId ?? null,
      markdownPath: run.activeRoughOutline?.markdownPath ?? null,
      markdownHash: run.activeRoughOutline?.markdownHash ?? null,
      syncStatus: run.activeRoughOutline?.syncStatus ?? null,
    },
    detailedOutline: {
      artifactId: run.activeDetailedOutline?.artifactId ?? null,
      markdownPath: run.activeDetailedOutline?.markdownPath ?? null,
      markdownHash: run.activeDetailedOutline?.markdownHash ?? null,
      syncStatus: run.activeDetailedOutline?.syncStatus ?? null,
    },
    proseSelection: {
      artifactId: run.activeProseSelection?.artifactId ?? null,
      eventReference: run.activeProseSelection?.eventReference ?? null,
    },
    characterCompilation: {
      markdownPath: run.activeCharacterCompilation?.markdownPath ?? null,
      fileCount: run.activeCharacterCompilation?.fileCount ?? null,
    },
    activeArtifactMap,
  }
}

export interface GateStatusDump {
  stage: Stage
  reviewStage: ReviewStage | null
  requiredGates: readonly ReviewGateName[]
  missingGates: ReviewGateName[]
  passingGates: ReviewGateName[]
  failingGates: ReviewGateName[]
  staleReviews: { reviewId: string; gate: ReviewGateName; reviewHash: string; currentHash: string }[]
  perGateStatus: Record<string, { status: string; reviewId: string | null; reviewHash: string | null; stale: boolean }>
  proseAllowed: boolean | null
}

export async function dumpGateStatus(run: RunState, root: string): Promise<GateStatusDump> {
  const reviewStage = toReviewStage(run.stage)
  const requiredGates = getRequiredReviewGates(run.stage)
  const reviews = await readRunReviews(run, root)
  const artifactId =
    run.stage === "rough_outline_review"
      ? getActiveRoughOutlineArtifactId(run)
      : run.stage === "detailed_outline_review"
        ? getActiveDetailedOutlineArtifactId(run)
        : run.stage === "prose_review"
          ? getActiveProseArtifactId(run)
          : null
  const currentHash =
    run.stage === "rough_outline_review"
      ? run.activeRoughOutline?.markdownHash ?? null
      : run.stage === "detailed_outline_review"
        ? run.activeDetailedOutline?.markdownHash ?? null
        : run.stage === "prose_review"
          ? null
          : null

  const relevantReviews = reviews.filter(
    (review) => review.stage === reviewStage && artifactId && review.reviewedArtifactId === artifactId,
  )

  const perGateStatus: Record<string, { status: string; reviewId: string | null; reviewHash: string | null; stale: boolean }> = {}
  const passingGates: ReviewGateName[] = []
  const failingGates: ReviewGateName[] = []
  const missingGates: ReviewGateName[] = []
  const staleReviews: GateStatusDump["staleReviews"] = []

  for (const gate of requiredGates) {
    const gateReviews = relevantReviews.filter((review) => review.gate === gate)
    if (gateReviews.length === 0) {
      missingGates.push(gate)
      perGateStatus[gate] = { status: "missing", reviewId: null, reviewHash: null, stale: false }
      continue
    }
    for (const review of gateReviews) {
      const stale = currentHash ? isReviewStale(review, currentHash) : true
      if (stale) {
        staleReviews.push({ reviewId: review.artifactId, gate: review.gate, reviewHash: review.artifactHash, currentHash: currentHash ?? "unknown" })
      }
      const blocking = review.status !== "pass" || review.severity === "blocking" || review.blockingIssues.length > 0
      if (blocking) {
        failingGates.push(gate)
      } else if (!stale) {
        passingGates.push(gate)
      }
      perGateStatus[gate] = { status: stale ? "stale" : review.status, reviewId: review.artifactId, reviewHash: review.artifactHash, stale }
    }
  }

  const proseAllowed =
    reviewStage === "detailed_outline_review" && currentHash
      ? missingGates.length === 0 && failingGates.length === 0 && staleReviews.length === 0
      : null

  return {
    stage: run.stage,
    reviewStage,
    requiredGates,
    missingGates,
    passingGates,
    failingGates,
    staleReviews,
    perGateStatus,
    proseAllowed,
  }
}

export interface IngestStatusDump {
  chunkDirectory: string
  exists: boolean
  chunks: {
    order: number
    status: string
    contentHash: string
    byteSize: number
    sourceId?: string
    evidencePackId?: string
    error?: string
  }[]
}

export async function dumpIngestStatus(root: string): Promise<IngestStatusDump> {
  const chunkDirectory = resolve(root, AUTHORED_DIR, "ingest-chunks")
  let exists = false
  let entries: string[] = []

  try {
    entries = await readdir(chunkDirectory)
    exists = true
  } catch {
    return { chunkDirectory, exists: false, chunks: [] }
  }

  const metaEntries = entries.filter((e) => e.endsWith(".meta.json"))
  const chunks: IngestStatusDump["chunks"] = []

  for (const entry of metaEntries) {
    const orderMatch = entry.match(/^chunk-(\d{3})\.meta\.json$/)
    if (!orderMatch) continue
    const order = parseInt(orderMatch[1], 10)
    try {
      const raw = await readFile(resolve(chunkDirectory, entry), "utf8")
      const meta = JSON.parse(raw)
      chunks.push({
        order,
        status: meta.status ?? "unknown",
        contentHash: meta.chunkHash ?? "",
        byteSize: meta.byteSize ?? 0,
        sourceId: meta.sourceId,
        evidencePackId: meta.evidencePackId,
        error: meta.error,
      })
    } catch {
      chunks.push({ order, status: "corrupt", contentHash: "", byteSize: 0 })
    }
  }

  chunks.sort((a, b) => a.order - b.order)
  return { chunkDirectory, exists, chunks }
}

function getRequiredReviewGates(stage: Stage): readonly ReviewGateName[] {
  if (stage === "rough_outline_review" || stage === "detailed_outline_review") {
    return RequiredOutlineReviewGates
  }
  if (stage === "prose_review") {
    return RequiredProseReviewGates
  }
  return []
}

function toReviewStage(stage: Stage): ReviewStage | null {
  if (stage === "rough_outline_review" || stage === "detailed_outline_review" || stage === "prose_review") {
    return stage
  }
  return null
}
