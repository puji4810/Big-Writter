import { RequiredOutlineReviewGates, RequiredProseReviewGates, type ReviewGateName } from "../schemas/review"
import type { Stage } from "../schemas/run"
import type {
  ActiveArtifactsMap,
  PolicyDecision,
  PolicyInput,
  PolicyTarget,
  SpecialistAgentName,
} from "./types"

const LONG_TEXT_INGEST_THRESHOLD = 4000

const stageOrder: readonly Stage[] = [
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
]

const reviewerByGate: Record<ReviewGateName, SpecialistAgentName> = {
  "logic-world-motivation": "logic-world-motivation-reviewer",
  "prose-style-pacing": "prose-style-pacing-reviewer",
  "continuity": "continuity-checker",
  "preference-boundary": "preference-boundary-checker",
}

export function evaluate(input: PolicyInput): PolicyDecision {
  const { context, intent } = input

  if (intent.type === "status_check") {
    return {
      action: "stay",
      targetAgent: "creative-director",
      reason: "Status and read requests remain with the primary agent.",
    }
  }

  if (intent.type === "corpus_analysis") {
    return {
      action: "dispatch",
      targetAgent: "corpus-analyst",
      reason: "Corpus analysis is always routed to the corpus specialist.",
    }
  }

  if (intent.type === "ingest_request") {
    if (shouldTriggerIngest(context.input.type, context.input.textLength, context.input.fileCount)) {
      return {
        action: "trigger_ingest",
        targetAgent: "ingest-staging-pipeline",
        reason: "Long-form or file-based ingest requests must be staged through the ingest pipeline.",
      }
    }

    return {
      action: "stay",
      targetAgent: "creative-director",
      reason: "Short ingest instructions stay with the primary agent for clarification or batching.",
    }
  }

  if (intent.type === "ingest_completion") {
    return {
      action: "dispatch",
      targetAgent: "corpus-analyst",
      reason: "Ingest completion triggers follow-up corpus analysis to extract structured traits from the ingested material.",
    }
  }

  if (intent.type === "outline_request") {
    if (shouldTriggerCompile(context.stage, context.input.type, context.activeArtifacts, ["rough_outline", "detailed_outline"])) {
      return {
        action: "trigger_compile",
        targetAgent: "markdown-compiler",
        reason: "Active outline markdown must be compiled before additional outline work is dispatched.",
      }
    }

    if (context.stage === "rough_outline_review") {
      return createReviewDispatch(context.stage, context.reviewStatus, RequiredOutlineReviewGates)
    }

    if (context.stage === "detailed_outline_review") {
      const missingReviewGates = getMissingReviewGates(context.reviewStatus, RequiredOutlineReviewGates)
      if (missingReviewGates.length > 0) {
        return createReviewDispatch(context.stage, context.reviewStatus, RequiredOutlineReviewGates)
      }
    }

    if (context.stage === "rough_outline_draft" || context.stage === "rough_outline_revision_required") {
      return {
        action: "dispatch",
        targetAgent: "rough-outliner",
        reason: "Rough outline work is routed to the rough outliner during rough outline drafting stages.",
      }
    }

    if (context.stage === "detailed_outline_draft" || context.stage === "detailed_outline_revision_required") {
      return {
        action: "dispatch",
        targetAgent: "detailed-outliner",
        reason: "Detailed outline work is routed to the detailed outliner during detailed outline drafting stages.",
      }
    }

    return {
      action: "stay",
      targetAgent: "creative-director",
      reason: "Outline requests outside active outline stages stay with the primary agent.",
    }
  }

  if (intent.type === "review_request") {
    if (context.stage === "rough_outline_review") {
      return createReviewDispatch(context.stage, context.reviewStatus, RequiredOutlineReviewGates)
    }

    if (context.stage === "detailed_outline_review") {
      return createReviewDispatch(context.stage, context.reviewStatus, RequiredOutlineReviewGates)
    }

    if (context.stage === "prose_review") {
      return createReviewDispatch(context.stage, context.reviewStatus, RequiredProseReviewGates)
    }

    return {
      action: "stay",
      targetAgent: "creative-director",
      reason: "When no review gate is active, the primary agent keeps the request.",
    }
  }

  if (intent.type === "prose_request") {
    if (!isDetailedOutlineApproved(context.stage, context.reviewStatus)) {
      const missingReviewGates = getMissingReviewGates(context.reviewStatus, RequiredOutlineReviewGates)
      return {
        action: "block",
        reason: "Prose is refused until the detailed outline is approved.",
        blockingReason: "Detailed outline approval is required before prose work can begin.",
        blocking: {
          currentStage: context.stage,
          requiredStage: "event_selection",
          missingReviewGates,
        },
      }
    }

    if (shouldTriggerCompile(context.stage, context.input.type, context.activeArtifacts, ["prose"])) {
      return {
        action: "trigger_compile",
        targetAgent: "markdown-compiler",
        reason: "Active prose markdown must be compiled before more prose work is dispatched.",
      }
    }

    if (context.stage === "prose_review") {
      return createReviewDispatch(context.stage, context.reviewStatus, RequiredProseReviewGates)
    }

    return {
      action: "dispatch",
      targetAgent: "writer",
      reason: "Prose requests are routed to the writer once the detailed outline gate has been cleared.",
    }
  }

  return {
    action: "stay",
    targetAgent: "creative-director",
    reason: "Requests that do not match a specialist rule stay with the primary agent.",
  }
}

function shouldTriggerIngest(inputType: PolicyInput["context"]["input"]["type"], textLength: number, fileCount: number): boolean {
  return inputType === "file_list" || textLength >= LONG_TEXT_INGEST_THRESHOLD || fileCount > 0
}

function shouldTriggerCompile(
  stage: Stage,
  inputType: PolicyInput["context"]["input"]["type"],
  activeArtifacts: ActiveArtifactsMap,
  artifactKinds: readonly (keyof ActiveArtifactsMap)[],
): boolean {
  if (inputType !== "markdown") return false
  if (stage === "uninitialized" || stage === "interviewing") return false

  return artifactKinds.some((artifactKind) => {
    const artifacts = activeArtifacts[artifactKind]
    return (artifacts ?? []).some((artifact) => artifact.format === "markdown")
  })
}

function isDetailedOutlineApproved(stage: Stage, reviewStatus: PolicyInput["context"]["reviewStatus"]): boolean {
  if (isStageAtOrBeyond(stage, "event_selection")) {
    return true
  }

  if (stage !== "detailed_outline_review") {
    return false
  }

  return getMissingReviewGates(reviewStatus, RequiredOutlineReviewGates).length === 0
}

function isStageAtOrBeyond(stage: Stage, minimumStage: Stage): boolean {
  return stageOrder.indexOf(stage) >= stageOrder.indexOf(minimumStage)
}

function createReviewDispatch(
  stage: Stage,
  reviewStatus: PolicyInput["context"]["reviewStatus"],
  requiredGates: readonly ReviewGateName[],
): PolicyDecision {
  const missingReviewGates = getMissingReviewGates(reviewStatus, requiredGates)
  const dispatchedAgents = selectReviewerAgents(missingReviewGates.length > 0 ? missingReviewGates : requiredGates)

  return {
    action: "dispatch",
    targetAgent: "reviewers",
    reason: `The ${stage} stage requires explicit reviewer dispatch before the workflow can continue.`,
    metadata: {
      dispatchedAgents,
      missingReviewGates,
    },
  }
}

function getMissingReviewGates(
  reviewStatus: PolicyInput["context"]["reviewStatus"],
  requiredGates: readonly ReviewGateName[],
): ReviewGateName[] {
  return requiredGates.filter((gate) => reviewStatus[gate] !== "pass")
}

function selectReviewerAgents(gates: readonly ReviewGateName[]): SpecialistAgentName[] {
  return gates.map((gate) => reviewerByGate[gate])
}

export const orchestrationConstants = {
  LONG_TEXT_INGEST_THRESHOLD,
} as const satisfies Record<string, number>

export const orchestrationTargets = {
  reviewers: "reviewers",
  markdownCompiler: "markdown-compiler",
  ingestStagingPipeline: "ingest-staging-pipeline",
} as const satisfies Record<string, PolicyTarget>
