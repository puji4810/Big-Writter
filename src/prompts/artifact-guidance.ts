export const WRITABLE_ARTIFACT_KINDS = [
  "interview",
  "rough_outline",
  "detailed_outline",
  "draft",
  "review",
  "evidence_pack",
  "canon_fact_set",
  "boundary_profile",
] as const

export type WritableArtifactKind = (typeof WRITABLE_ARTIFACT_KINDS)[number]

export const RUN_ARTIFACT_BASE_FIELDS = {
  schemaVersion: { description: "Schema version string", value: '"1.0.0"' },
  artifactId: { description: "Unique artifact identifier; must match artifact.artifactId for run artifacts" },
  runId: { description: "Current run identifier from run state" },
  createdAt: { description: "ISO-8601 timestamp string" },
  stage: { description: "Exact literal stage string required by this artifact schema" },
  sourceArtifactIds: { description: "Array of upstream artifact IDs; empty array [] only when no source exists" },
  status: { description: 'One of: "draft", "ready_for_review", "approved", "revision_required", "accepted", "archived"' },
} as const

export const INTERVIEW_ADVANCEMENT_GATE_GUIDANCE = `To advance from "interviewing" to "rough_outline_draft", all three gates must be satisfied:
- hasInterviewArtifact: a valid interview artifact has been stored via novel_write_artifact
- hasTargetAudience: the target audience is confirmed in the interview content
- hasStoryObjective: the story objective is confirmed in the interview content`

export function buildArtifactPayloadGuidance(): string {
  return `## Artifact Payload Guidance

### Selector vs Payload
The \`artifact\` argument is a SELECTOR: \`{ kind: "kind_name", artifactId: "id" }\` for run artifacts, or \`{ kind: "boundary_profile" }\` for preferences.
The \`payload\` argument is the full SCHEMA BODY object validated with \`.strict()\` rules.
These are NOT interchangeable. Do not put selector fields in payload or vice versa.

### Strict Validation
All payloads are \`.strict()\` validated. Do NOT include unknown top-level keys. Extra keys will cause validation failure.
For Interview artifacts specifically: do NOT place premise, genre, tone, hardBoundaries, characters, storyStructure, currentStatus, targetAudience, or storyObjective as top-level keys. Put concepts like premise, genre, tone, and boundaries inside questions[].answer entries or the summary field.

### Run Artifact Base Fields
Every run artifact payload (all kinds except boundary_profile) must include these fields:

- **schemaVersion**: Use "1.0.0"
- **artifactId**: Match the artifact.artifactId from the selector
- **runId**: Copy from current run state
- **createdAt**: Current ISO-8601 timestamp
- **stage**: Exact literal required for this artifact kind (see per-kind templates)
- **sourceArtifactIds**: Array of upstream artifact IDs; use [] only when no source exists
- **status**: One of draft, ready_for_review, approved, revision_required, accepted, archived

### Per-Kind Field Inventories

#### interview
Base fields + stage: "interviewing", questions: [{ question: string, answer: string }], summary: string
CRITICAL: Do NOT put premise, genre, tone, hardBoundaries, characters, storyStructure, currentStatus, targetAudience, or storyObjective as top-level keys. These concepts go inside answers and/or summary.

#### rough_outline
Base fields + stage: "rough_outline_draft", logline: string, acts: [{ title: string, summary: string, goals?: string, stakes?: string, keyEvents?: string, keyEventsList?: string[] }], contentHash: string, version: number, optional: arcIntent?: string, coreConflicts?: string, worldAssumptions?: string, protagonistEmotionalTrajectory?: string

#### detailed_outline
Base fields + stage: "detailed_outline_draft", chapters: [{ chapterNumber: number, title: string, synopsis: string, keyEvents: string[], goal?: string, povFocus?: string, setupPayoff?: string, conflictEscalation?: string, worldCanonDependencies?: string, characterMotivationBeats?: string, endingHook?: string, continuityHooks?: string }], contentHash: string, version: number

#### draft
Base fields + stage: "prose_draft", proseContent: string, factAssumptions: [{ subject: string, predicate: string, object: string }], eventReference: string, contentHash: string, version: number

#### review
Base fields + stage: one of "rough_outline_review", "detailed_outline_review", "prose_review", gate: one of "logic-world-motivation", "prose-style-pacing", "continuity", "preference-boundary", status: one of "pass", "fail", "needs_user_input", severity: one of "blocking", "warning", "info", blockingIssues: [{ issue: string, suggestedFix: string }], nonBlockingSuggestions: string[], affectedArtifactIds: string[], artifactHash: string, reason: string, suggestedFix: string, requiresUserDecision: boolean, reviewedArtifactId: string, reviewedArtifactHash: string, reviewedArtifactVersion: number, deltas: [{ path: string, issue: string, recommendation: string }], reviewerId: string, optional: decision?: "approved" | "revision_required"

#### evidence_pack
Base fields + stage: one of "rough_outline_draft", "detailed_outline_draft", "event_selection", "prose_draft", sourceIds: string[], claims: [{ claim: string, sourceIds: string[] }], optional: abstractEvidence?: [...]
Note: abstractEvidence is an array of evidence chunk objects with sourceId, pacingSummary, styleTraits, tropeTags, dialogueRatio, actionRatio, narrationRatio, sceneFunctions.

#### canon_fact_set
Base fields + stage: "canon_accepted", acceptedArtifactHash: string, facts: [{ factId: string, subject: string, predicate: string, object: string, evidenceArtifactIds: string[] }]

#### boundary_profile
NOT a run artifact. Fields: schemaVersion: "1.0.0", projectId: string, profileId: string, preferredTone: string[], avoidedContent: string[], hardBoundaries: string[], updatedAt: string (ISO-8601)
The artifact selector for boundary_profile is: { kind: "boundary_profile" } -- no artifactId needed.
The payload uses profileId, NOT artifactId.`
}
