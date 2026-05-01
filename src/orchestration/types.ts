import type { ReviewGateName, ReviewStatus } from "../schemas/review"
import type { Stage } from "../schemas/run"

export type PolicyIntent =
  | { type: "outline_request" }
  | { type: "prose_request" }
  | { type: "ingest_request" }
  | { type: "ingest_completion" }
  | { type: "corpus_analysis" }
  | { type: "status_check" }
  | { type: "review_request" }

export type PolicyArtifactKind = "rough_outline" | "detailed_outline" | "prose" | "review" | "corpus"
export type PolicyArtifactFormat = "json" | "markdown" | "text"
export type PolicyInputType = "plain_text" | "markdown" | "file_list" | "artifact_reference" | "status_query"
export type PolicyReviewState = ReviewStatus | "missing"

export type ActiveArtifact = {
  id: string
  kind: PolicyArtifactKind
  format: PolicyArtifactFormat
}

export type ActiveArtifactsMap = Partial<Record<PolicyArtifactKind, ActiveArtifact[]>>
export type ReviewStatusMap = Partial<Record<ReviewGateName, PolicyReviewState>>

export type PolicyContext = {
  stage: Stage
  activeArtifacts: ActiveArtifactsMap
  reviewStatus: ReviewStatusMap
  input: {
    type: PolicyInputType
    textLength: number
    fileCount: number
  }
}

export type PolicyAction = "stay" | "dispatch" | "block" | "trigger_compile" | "trigger_ingest"

export type SpecialistAgentName =
  | "creative-director"
  | "idea-interviewer"
  | "rough-outliner"
  | "detailed-outliner"
  | "writer"
  | "corpus-analyst"
  | "logic-world-motivation-reviewer"
  | "prose-style-pacing-reviewer"
  | "continuity-checker"
  | "preference-boundary-checker"

export type PolicyTarget = SpecialistAgentName | "reviewers" | "markdown-compiler" | "ingest-staging-pipeline"

export type PolicyBlockingMetadata = {
  currentStage: Stage
  requiredStage?: Stage
  missingReviewGates?: ReviewGateName[]
}

export type PolicyDecision = {
  action: PolicyAction
  targetAgent?: PolicyTarget
  reason: string
  blockingReason?: string
  blocking?: PolicyBlockingMetadata
  metadata?: {
    dispatchedAgents?: SpecialistAgentName[]
    missingReviewGates?: ReviewGateName[]
  }
}

export type PolicyInput = {
  intent: PolicyIntent
  context: PolicyContext
}
