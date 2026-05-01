import { createHash } from "node:crypto"
import { z } from "zod"
import { RunArtifactBaseSchema, StageSchema } from "./run"

export const ReviewDecisionSchema = z.enum(["approved", "revision_required"])
export const ReviewGateNameSchema = z.enum(["logic-world-motivation", "prose-style-pacing", "continuity", "preference-boundary"])
export const ReviewStatusSchema = z.enum(["pass", "fail", "needs_user_input"])
export const ReviewSeveritySchema = z.enum(["blocking", "warning", "info"])

export const RequiredOutlineReviewGates = ["logic-world-motivation", "continuity", "preference-boundary"] as const satisfies readonly z.infer<typeof ReviewGateNameSchema>[]
export const RequiredProseReviewGates = ReviewGateNameSchema.options

const ReviewBlockingIssueSchema = z.object({
  issue: z.string().min(1),
  suggestedFix: z.string().min(1),
}).strict()

function normalizeReviewStatus(status: unknown): unknown {
  if (status === "approved") return "pass"
  if (status === "revision_required") return "fail"
  return status
}

function normalizeReviewInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input

  const review = input as Record<string, unknown>
  if (!("status" in review)) return input

  const normalized: Record<string, unknown> = {
    ...review,
    status: normalizeReviewStatus(review.status),
  }
  if (!("artifactHash" in normalized) && typeof normalized.reviewedArtifactHash === "string") {
    normalized.artifactHash = normalized.reviewedArtifactHash
  }

  return normalized
}

const ReviewResultBaseSchema = RunArtifactBaseSchema.extend({
  stage: z.enum(["rough_outline_review", "detailed_outline_review", "prose_review"]),
  gate: ReviewGateNameSchema,
  status: ReviewStatusSchema,
  severity: ReviewSeveritySchema,
  blockingIssues: z.array(ReviewBlockingIssueSchema),
  nonBlockingSuggestions: z.array(z.string().min(1)),
  affectedArtifactIds: z.array(z.string().min(1)),
  artifactHash: z.string().min(1),
  reason: z.string().min(1),
  suggestedFix: z.string().min(1),
  requiresUserDecision: z.boolean(),
  reviewedArtifactId: z.string().min(1),
  reviewedArtifactHash: z.string().min(1),
  reviewedArtifactVersion: z.number().int().positive(),
  decision: ReviewDecisionSchema.optional(),
  deltas: z.array(z.object({
    path: z.string().min(1),
    issue: z.string().min(1),
    recommendation: z.string().min(1),
  }).strict()),
  reviewerId: z.string().min(1),
}).strict().superRefine((review, ctx) => {
  if (review.status === "needs_user_input" && !review.requiresUserDecision) {
    ctx.addIssue({ code: "custom", path: ["requiresUserDecision"], message: "needs_user_input reviews must require a user decision" })
  }

  if (review.status === "pass" && review.severity === "blocking") {
    ctx.addIssue({ code: "custom", path: ["severity"], message: "passing reviews cannot have blocking severity" })
  }
})

export const ReviewResultSchema = z.preprocess(normalizeReviewInput, ReviewResultBaseSchema)

export const ReviewGateSchema = z.object({
  review: ReviewResultSchema,
  currentArtifactHash: z.string().min(1),
}).strict()

export const ReviewGateSetSchema = z.object({
  reviews: z.array(ReviewResultSchema),
  currentArtifactHash: z.string().min(1),
}).strict()

export const StageGateInputSchema = z.object({
  reviewGate: ReviewGateSchema.optional(),
  reviewGateSet: ReviewGateSetSchema.optional(),
  hasInterviewArtifact: z.boolean().optional(),
  hasTargetAudience: z.boolean().optional(),
  hasStoryObjective: z.boolean().optional(),
  hasDraftArtifact: z.boolean().optional(),
  explicitCanonAcceptance: z.object({
    acceptedBy: z.string().min(1),
    acceptedAt: z.string().datetime(),
    acceptedArtifactHash: z.string().min(1),
    action: z.literal("accept_canon"),
  }).strict().optional(),
}).strict()

export function computeArtifactHash(content: string): string {
  return createHash("sha256").update(content).digest("hex")
}

export function isReviewStale(review: ReviewResult, currentHash: string): boolean {
  return review.artifactHash !== currentHash || review.reviewedArtifactHash !== currentHash
}

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>
export type ReviewGateName = z.infer<typeof ReviewGateNameSchema>
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>
export type ReviewResult = z.infer<typeof ReviewResultSchema>
export type ReviewGate = z.infer<typeof ReviewGateSchema>
export type ReviewGateSet = z.infer<typeof ReviewGateSetSchema>
export type StageGateInput = z.infer<typeof StageGateInputSchema>
export type ReviewStage = Extract<z.infer<typeof StageSchema>, "rough_outline_review" | "detailed_outline_review" | "prose_review">
