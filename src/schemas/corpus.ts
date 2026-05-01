import { z } from "zod"
import { RunArtifactBaseSchema } from "./run"

export const CorpusSourceSchema = z.object({
  schemaVersion: z.string().min(1),
  sourceId: z.string().min(1),
  projectId: z.string().min(1),
  kind: z.enum(["interview", "reference", "canon", "style_guide"]),
  title: z.string().min(1),
  contentHash: z.string().min(1),
  filename: z.string().min(1).optional(),
  byteSize: z.number().int().nonnegative().optional(),
  importedAt: z.string().datetime().optional(),
  authorizationNote: z.string().min(1).optional(),
  createdAt: z.string().datetime(),
}).strict()

export const ChapterDetectionSchema = z.enum(["markdown_heading", "numbered_chapter", "none"])
export const SceneFunctionSchema = z.enum([
  "setup",
  "conflict",
  "revelation",
  "transition",
  "climax",
  "resolution",
])

export const AbstractEvidenceSchema = z.object({
  sourceId: z.string().min(1),
  chunkCount: z.number().int().positive(),
  chapterDetection: ChapterDetectionSchema,
  pacingSummary: z.string().min(1),
  styleTraits: z.array(z.string().min(1)),
  tropeTags: z.array(z.string().min(1)),
  dialogueRatio: z.number().min(0).max(1),
  actionRatio: z.number().min(0).max(1),
  narrationRatio: z.number().min(0).max(1),
  sceneFunctions: z.array(SceneFunctionSchema),
}).strict()

export const EvidencePackSchema = RunArtifactBaseSchema.extend({
  stage: z.enum(["rough_outline_draft", "detailed_outline_draft", "event_selection", "prose_draft"]),
  sourceIds: z.array(z.string().min(1)).min(1),
  claims: z.array(z.object({
    claim: z.string().min(1),
    sourceIds: z.array(z.string().min(1)).min(1),
  }).strict()).min(1),
  abstractEvidence: z.array(AbstractEvidenceSchema).optional(),
}).strict()

export type CorpusSource = z.infer<typeof CorpusSourceSchema>
export type EvidencePack = z.infer<typeof EvidencePackSchema>
export type AbstractEvidence = z.infer<typeof AbstractEvidenceSchema>
export type ChapterDetection = z.infer<typeof ChapterDetectionSchema>
export type SceneFunction = z.infer<typeof SceneFunctionSchema>
