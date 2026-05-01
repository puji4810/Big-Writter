import { StageGraph } from "../stage-graph"
import { evaluate } from "../orchestration/policy"
import { isProseAllowed } from "../workflow/review-orchestrator"
import { readRunReviews } from "../tools/common"
import { RequiredOutlineReviewGates, type ReviewGateName, type ReviewResult } from "../schemas/review"
import type { Stage, RunState } from "../schemas/run"
import type { PolicyIntent, PolicyDecision, PolicyInput, PolicyContext, ReviewStatusMap, ActiveArtifactsMap } from "../orchestration/types"
import { getActiveRoughOutlineArtifactId, getActiveDetailedOutlineArtifactId } from "../tools/common"

export type HandlerGuidance = {
  ok: boolean
  action: "init" | "continue" | "block" | "report" | "guide"
  stage?: Stage
  pendingGates?: string[]
  blockingReason?: string
  activeRoughOutline?: { artifactId: string; syncStatus: string; compiledAt?: string } | null
  activeDetailedOutline?: { artifactId: string; syncStatus: string; compiledAt?: string } | null
  reviewGateStatuses?: Record<ReviewGateName, string>
  policyDecision?: PolicyDecision
  guidance: string
}

function notInitializedGuidance(): HandlerGuidance {
  return {
    ok: false,
    action: "init",
    stage: "uninitialized",
    pendingGates: [],
    guidance: "Novel project is not initialized. Run /novel-start to initialize the project and begin the idea interview.",
  }
}

function buildReviewStatusMap(reviews: ReviewResult[]): ReviewStatusMap {
  const statusMap: ReviewStatusMap = {}
  for (const review of reviews) {
    const current = statusMap[review.gate]
    if (review.status === "pass" && current === "pass") continue
    if (review.status === "fail") {
      statusMap[review.gate] = "fail"
      continue
    }
    if (review.status === "needs_user_input") {
      statusMap[review.gate] = "needs_user_input"
      continue
    }
    if (!current) {
      statusMap[review.gate] = review.status
    }
  }
  return statusMap
}

function buildActiveArtifactsMap(run: RunState): ActiveArtifactsMap {
  const map: ActiveArtifactsMap = {}
  const roughId = getActiveRoughOutlineArtifactId(run)
  if (roughId) {
    map.rough_outline = [{ id: roughId, kind: "rough_outline", format: "json" }]
  }
  const detailedId = getActiveDetailedOutlineArtifactId(run)
  if (detailedId) {
    map.detailed_outline = [{ id: detailedId, kind: "detailed_outline", format: "json" }]
  }
  if (run.activeProseSelection) {
    map.prose = [{ id: run.activeProseSelection.artifactId, kind: "prose", format: "json" }]
  }
  return map
}

function syncStatusLabel(syncStatus: string | undefined): string {
  switch (syncStatus) {
    case "clean": return "clean"
    case "stale_markdown": return "stale (markdown changed, needs recompile)"
    case "compile_failed": return "compile failed"
    case "orphaned_generated": return "orphaned (no matching markdown)"
    default: return "unknown"
  }
}

export async function handleNovelStart(
  run: RunState | null,
  projectRoot: string,
): Promise<HandlerGuidance> {
  if (!run) {
    return {
      ok: false,
      action: "init",
      stage: "uninitialized",
      pendingGates: [],
      guidance: "No novel project found. Run /novel-start to initialize the project and create the .novel layout. The initialization will set up project metadata, run state, and required directories. Once initialized, the Creative Director will guide you through the idea interview using the IdeaInterviewer subagent.",
    }
  }

  const stage = run.stage
  const pendingGates = StageGraph.getRequiredGates(stage)
  const roughPointer = run.activeRoughOutline
  const detailedPointer = run.activeDetailedOutline
  let roughSync: string | undefined
  let detailedSync: string | undefined

  if (roughPointer) {
    roughSync = roughPointer.syncStatus === "clean" ? "clean" : syncStatusLabel(roughPointer.syncStatus)
  }
  if (detailedPointer) {
    detailedSync = detailedPointer.syncStatus === "clean" ? "clean" : syncStatusLabel(detailedPointer.syncStatus)
  }

  if (stage === "uninitialized") {
    return {
      ok: true,
      action: "continue",
      stage,
      pendingGates,
      activeRoughOutline: roughPointer ? { artifactId: roughPointer.artifactId, syncStatus: roughSync ?? "unknown", compiledAt: roughPointer.compiledAt } : null,
      activeDetailedOutline: detailedPointer ? { artifactId: detailedPointer.artifactId, syncStatus: detailedSync ?? "unknown", compiledAt: detailedPointer.compiledAt } : null,
      guidance: "Project is initialized but the run is at the uninitialized stage. Proceed with the idea interview or initialize a new run.",
    }
  }

  return {
    ok: true,
    action: "continue",
    stage,
    pendingGates,
    activeRoughOutline: roughPointer ? { artifactId: roughPointer.artifactId, syncStatus: roughSync ?? "unknown", compiledAt: roughPointer.compiledAt } : null,
    activeDetailedOutline: detailedPointer ? { artifactId: detailedPointer.artifactId, syncStatus: detailedSync ?? "unknown", compiledAt: detailedPointer.compiledAt } : null,
    guidance: `Project already initialized at stage "${stage}". Use /novel-continue to resume where you left off.`,
  }
}

export async function handleNovelContinue(
  run: RunState | null,
  projectRoot: string,
): Promise<HandlerGuidance> {
  if (!run) {
    return notInitializedGuidance()
  }

  const stage = run.stage
  const pendingGates = StageGraph.getRequiredGates(stage)
  const reviews = await readRunReviews(run, projectRoot)
  const reviewStatus = buildReviewStatusMap(reviews)
  const activeArtifacts = buildActiveArtifactsMap(run)

  const roughPointer = run.activeRoughOutline
  const detailedPointer = run.activeDetailedOutline

  const policyIntent: PolicyIntent = { type: "outline_request" }
  const policyContext: PolicyContext = {
    stage,
    activeArtifacts,
    reviewStatus,
    input: { type: "status_query", textLength: 0, fileCount: 0 },
  }
  const policyInput: PolicyInput = { intent: policyIntent, context: policyContext }
  const decision = evaluate(policyInput)

  if (stage === "uninitialized") {
    return {
      ok: false,
      action: "init",
      stage,
      pendingGates,
      guidance: "The run stage is uninitialized. Use /novel-start to begin the interview process and set the stage to interviewing.",
    }
  }

  const gateLabels: Record<string, string> = {
    hasInterviewArtifact: "Interview artifact is missing — complete the idea interview first",
    hasTargetAudience: "Target audience has not been defined",
    hasStoryObjective: "Story objective has not been defined",
    hasDraftArtifact: "Draft artifact is missing — generate the required draft first",
    reviewGate: "Review gates must be completed before advancing",
    explicitCanonAcceptance: "Explicit canon acceptance is required to finalize the project",
  }

  const gateGuidance = pendingGates
    .map((gate) => `  - ${gate}: ${gateLabels[gate] ?? "Gate action required"}`)
    .join("\n")

  const blockingReason = decision.action === "block" ? decision.blockingReason ?? "Blocked by policy" : undefined

  return {
    ok: decision.action !== "block",
    action: decision.action === "block" ? "block" : "continue",
    stage,
    pendingGates,
    blockingReason,
    activeRoughOutline: roughPointer ? { artifactId: roughPointer.artifactId, syncStatus: syncStatusLabel(roughPointer.syncStatus), compiledAt: roughPointer.compiledAt } : null,
    activeDetailedOutline: detailedPointer ? { artifactId: detailedPointer.artifactId, syncStatus: syncStatusLabel(detailedPointer.syncStatus), compiledAt: detailedPointer.compiledAt } : null,
    reviewGateStatuses: Object.keys(reviewStatus).length > 0 ? (reviewStatus as Record<ReviewGateName, string>) : undefined,
    policyDecision: decision,
    guidance: `Current stage: ${stage}\n\nPending gates:\n${gateGuidance}\n\n${decision.action === "dispatch" ? `Next action: dispatch to ${decision.targetAgent ?? "specialist"} — ${decision.reason}` : decision.action === "stay" ? "Continue with the Creative Director." : decision.action === "trigger_compile" ? `Markdown compilation needed: ${decision.reason}` : decision.action === "trigger_ingest" ? `Ingest staging needed: ${decision.reason}` : decision.action === "block" ? `BLOCKED: ${decision.blockingReason ?? "Access denied"}` : `Action: ${decision.action}`}`,
  }
}

export async function handleNovelWriteEvent(
  run: RunState | null,
  projectRoot: string,
  eventRef?: string,
): Promise<HandlerGuidance> {
  if (!run) {
    return notInitializedGuidance()
  }

  const stage = run.stage
  const detailedPointer = run.activeDetailedOutline
  const detailedArtifactId = getActiveDetailedOutlineArtifactId(run)

  if (!detailedPointer || !detailedArtifactId) {
    return {
      ok: false,
      action: "block",
      stage,
      blockingReason: "No active detailed outline found. Complete the detailed outline stage first before writing prose.",
      guidance: "Cannot write event prose: No active detailed outline is available. Complete the detailed outline review and have it approved before writing events.",
    }
  }

  const staleMarkdown = detailedPointer.syncStatus !== "clean"
  if (staleMarkdown) {
    return {
      ok: false,
      action: "block",
      stage,
      blockingReason: `Detailed outline markdown is stale (${detailedPointer.syncStatus}). Recompile the outline and re-run reviews before writing prose.`,
      activeDetailedOutline: { artifactId: detailedPointer.artifactId, syncStatus: syncStatusLabel(detailedPointer.syncStatus), compiledAt: detailedPointer.compiledAt },
      guidance: `Cannot write event prose: Detailed outline markdown is stale.\n\nCurrent stage: ${stage}\nDetailed outline sync: ${syncStatusLabel(detailedPointer.syncStatus)}\n\nRecompile the detailed outline markdown and run all required reviews before writing prose.`,
    }
  }

  const hash = detailedPointer.markdownHash
  const allowed = await isProseAllowed(run, hash, projectRoot)

  if (!allowed) {
    const reviews = await readRunReviews(run, projectRoot)
    const relevantReviews = reviews.filter(
      (review) => review.stage === "detailed_outline_review" && review.reviewedArtifactId === detailedArtifactId,
    )
    const reviewStatus = buildReviewStatusMap(relevantReviews)
    const missingGates = RequiredOutlineReviewGates.filter((gate) => reviewStatus[gate] !== "pass")
    const staleMarkdown = detailedPointer.syncStatus !== "clean"

    let blockingDetail = "Detailed outline approval is required before prose drafting can begin."
    if (missingGates.length > 0) {
      blockingDetail += ` Missing review gates: ${missingGates.join(", ")}.`
    }
    if (staleMarkdown) {
      blockingDetail += ` Your detailed outline markdown is stale (${detailedPointer.syncStatus}). Recompile it and re-run reviews before writing prose.`
    }

    return {
      ok: false,
      action: "block",
      stage,
      blockingReason: blockingDetail,
      activeDetailedOutline: { artifactId: detailedPointer.artifactId, syncStatus: syncStatusLabel(detailedPointer.syncStatus), compiledAt: detailedPointer.compiledAt },
      reviewGateStatuses: Object.keys(reviewStatus).length > 0 ? (reviewStatus as Record<ReviewGateName, string>) : undefined,
      guidance: `Cannot write event prose: Detailed outline must be approved before writing events.\n\nCurrent stage: ${stage}\nDetailed outline sync: ${syncStatusLabel(detailedPointer.syncStatus)}\nMissing review gates: ${missingGates.length > 0 ? missingGates.join(", ") : "none"}\n\nComplete the detailed outline review and recompile if the markdown is stale.`,
    }
  }

  return {
    ok: true,
    action: "continue",
    stage,
    activeDetailedOutline: { artifactId: detailedPointer.artifactId, syncStatus: syncStatusLabel(detailedPointer.syncStatus), compiledAt: detailedPointer.compiledAt },
    guidance: eventRef
      ? `Prose writing is allowed for event "${eventRef}". Delegate to the Writer subagent to draft prose for this event. The Writer will produce prose and store it as a draft artifact.`
      : "Prose writing is allowed. Specify an event reference to begin writing.",
  }
}

export async function handleNovelStatus(
  run: RunState | null,
  projectRoot: string,
): Promise<HandlerGuidance> {
  if (!run) {
    return notInitializedGuidance()
  }

  const stage = run.stage
  const pendingGates = StageGraph.getRequiredGates(stage)
  const reviews = await readRunReviews(run, projectRoot)
  const reviewStatus = buildReviewStatusMap(reviews)

  const roughPointer = run.activeRoughOutline
  const detailedPointer = run.activeDetailedOutline
  const prosePointer = run.activeProseSelection
  const charPointer = run.activeCharacterCompilation

  const lines: string[] = [
    `Run ID: ${run.runId}`,
    `Project ID: ${run.projectId}`,
    `Stage: ${stage}`,
    `Last updated: ${run.updatedAt}`,
    `Total artifacts: ${run.artifactIds.length}`,
    "",
  ]

  if (roughPointer) {
    lines.push(`Active Rough Outline:`)
    lines.push(`  Artifact: ${roughPointer.artifactId}`)
    lines.push(`  Markdown: ${roughPointer.markdownPath}`)
    lines.push(`  Sync Status: ${syncStatusLabel(roughPointer.syncStatus)}`)
    lines.push(`  Compiled: ${roughPointer.compiledAt}`)
    lines.push("")
  }

  if (detailedPointer) {
    lines.push(`Active Detailed Outline:`)
    lines.push(`  Artifact: ${detailedPointer.artifactId}`)
    lines.push(`  Markdown: ${detailedPointer.markdownPath}`)
    lines.push(`  Sync Status: ${syncStatusLabel(detailedPointer.syncStatus)}`)
    lines.push(`  Compiled: ${detailedPointer.compiledAt}`)
    lines.push("")
  }

  if (prosePointer) {
    lines.push(`Active Prose Selection:`)
    lines.push(`  Artifact: ${prosePointer.artifactId}`)
    lines.push(`  Event: ${prosePointer.eventReference}`)
    lines.push("")
  }

  if (charPointer) {
    lines.push(`Character Compilation:`)
    lines.push(`  Markdown: ${charPointer.markdownPath}`)
    lines.push(`  File count: ${charPointer.fileCount}`)
    lines.push(`  Compiled: ${charPointer.compiledAt}`)
    lines.push("")
  }

  if (pendingGates.length > 0) {
    lines.push(`Pending Gates:`)
    for (const gate of pendingGates) {
      lines.push(`  - ${gate}`)
    }
    lines.push("")
  }

  if (Object.keys(reviewStatus).length > 0) {
    lines.push(`Review Gate Statuses:`)
    for (const [gate, status] of Object.entries(reviewStatus)) {
      const symbol = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : status.toUpperCase()
      lines.push(`  ${gate}: ${symbol}`)
    }
  }

  return {
    ok: true,
    action: "report",
    stage,
    pendingGates,
    activeRoughOutline: roughPointer ? { artifactId: roughPointer.artifactId, syncStatus: syncStatusLabel(roughPointer.syncStatus), compiledAt: roughPointer.compiledAt } : null,
    activeDetailedOutline: detailedPointer ? { artifactId: detailedPointer.artifactId, syncStatus: syncStatusLabel(detailedPointer.syncStatus), compiledAt: detailedPointer.compiledAt } : null,
    reviewGateStatuses: Object.keys(reviewStatus).length > 0 ? (reviewStatus as Record<ReviewGateName, string>) : undefined,
    guidance: lines.join("\n"),
  }
}


