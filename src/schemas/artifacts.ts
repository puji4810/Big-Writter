import { z } from "zod"
import { RunArtifactBaseSchema } from "./run"

const OutlineSectionSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  goals: z.string().min(1).optional(),
  stakes: z.string().min(1).optional(),
  keyEvents: z.string().min(1).optional(),
  keyEventsList: z.array(z.string().min(1)).min(1).optional(),
}).strict()

const DetailedChapterSchema = z.object({
  chapterNumber: z.number().int().positive(),
  title: z.string().min(1),
  synopsis: z.string().min(1),
  keyEvents: z.array(z.string().min(1)).min(1),
  goal: z.string().min(1).optional(),
  povFocus: z.string().min(1).optional(),
  setupPayoff: z.string().min(1).optional(),
  conflictEscalation: z.string().min(1).optional(),
  worldCanonDependencies: z.string().min(1).optional(),
  characterMotivationBeats: z.string().min(1).optional(),
  endingHook: z.string().min(1).optional(),
  continuityHooks: z.string().min(1).optional(),
}).strict()

export const InterviewArtifactSchema = RunArtifactBaseSchema.extend({
  stage: z.literal("interviewing"),
  questions: z.array(z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
  }).strict()).min(1),
  summary: z.string().min(1),
}).strict()

export const RoughOutlineArtifactSchema = RunArtifactBaseSchema.extend({
  stage: z.literal("rough_outline_draft"),
  logline: z.string().min(1),
  acts: z.array(OutlineSectionSchema).min(1),
  arcIntent: z.string().min(1).optional(),
  coreConflicts: z.string().min(1).optional(),
  worldAssumptions: z.string().min(1).optional(),
  protagonistEmotionalTrajectory: z.string().min(1).optional(),
  contentHash: z.string().min(1),
  version: z.number().int().positive(),
}).strict()

export const DetailedOutlineArtifactSchema = RunArtifactBaseSchema.extend({
  stage: z.literal("detailed_outline_draft"),
  chapters: z.array(DetailedChapterSchema).min(1),
  contentHash: z.string().min(1),
  version: z.number().int().positive(),
}).strict()

export const DraftArtifactSchema = RunArtifactBaseSchema.extend({
  stage: z.literal("prose_draft"),
  proseContent: z.string().min(1),
  factAssumptions: z.array(z.object({
    subject: z.string().min(1),
    predicate: z.string().min(1),
    object: z.string().min(1),
  }).strict()),
  eventReference: z.string().min(1),
  contentHash: z.string().min(1),
  version: z.number().int().positive(),
}).strict()

export type InterviewArtifact = z.infer<typeof InterviewArtifactSchema>
export type RoughOutlineArtifact = z.infer<typeof RoughOutlineArtifactSchema>
export type DetailedOutlineArtifact = z.infer<typeof DetailedOutlineArtifactSchema>
export type DraftArtifact = z.infer<typeof DraftArtifactSchema>
