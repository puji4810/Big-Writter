import { z } from "zod"

export const PreferenceBoundaryProfileSchema = z.object({
  schemaVersion: z.string().min(1),
  projectId: z.string().min(1),
  profileId: z.string().min(1),
  preferredTone: z.array(z.string().min(1)),
  avoidedContent: z.array(z.string().min(1)),
  hardBoundaries: z.array(z.string().min(1)),
  updatedAt: z.string().datetime(),
}).strict()

export type PreferenceBoundaryProfile = z.infer<typeof PreferenceBoundaryProfileSchema>
