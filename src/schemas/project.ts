import { z } from "zod"

export const NovelProjectSchema = z.object({
  schemaVersion: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  premise: z.string().min(1),
  targetAudience: z.string().min(1),
  storyObjective: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict()

export type NovelProject = z.infer<typeof NovelProjectSchema>
