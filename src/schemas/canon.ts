import { z } from "zod"
import { RunArtifactBaseSchema } from "./run"

export const CanonFactSchema = z.object({
  factId: z.string().min(1),
  subject: z.string().min(1),
  predicate: z.string().min(1),
  object: z.string().min(1),
  evidenceArtifactIds: z.array(z.string().min(1)).min(1),
}).strict()

export const CanonFactSetSchema = RunArtifactBaseSchema.extend({
  stage: z.literal("canon_accepted"),
  acceptedArtifactHash: z.string().min(1),
  facts: z.array(CanonFactSchema).min(1),
}).strict()

export type CanonFact = z.infer<typeof CanonFactSchema>
export type CanonFactSet = z.infer<typeof CanonFactSetSchema>
