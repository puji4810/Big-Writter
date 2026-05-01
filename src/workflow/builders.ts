import { randomUUID } from "node:crypto"
import { computeArtifactHash } from "../schemas/review"
import { SCHEMA_VERSION, type ArtifactStatus, type RunState, type ProvenanceMeta } from "../schemas"
import type { RoughOutlineArtifact, DetailedOutlineArtifact, DraftArtifact } from "../schemas/artifacts"
import { parseRoughOutline, parseDetailedOutline } from "../authoring/parser"
import type { CharacterSheet } from "../authoring/types"


export interface CompileOutlineOptions {
  sourcePath: string
  templateVersion?: string
  sourceArtifactIds?: string[]
  status?: ArtifactStatus
  version?: number
}

export interface DraftFromEventOptions {
  sourcePath: string
  eventReference: string
  factAssumptions?: DraftArtifact["factAssumptions"]
  sourceArtifactIds?: string[]
  status?: ArtifactStatus
  version?: number
}

export interface CharacterCompilationResult {
  artifactId: string
  characters: CharacterSheet[]
  markdownPath: string
  compiledAt: string
  fileCount: number
}

export function compileRoughOutlineFromMarkdown(
  markdown: string,
  run: RunState,
  options: CompileOutlineOptions,
): RoughOutlineArtifact {
  const parseResult = parseRoughOutline(markdown)
  if (parseResult.errors.length > 0) {
    throw new Error(
      `Rough outline markdown parsing failed:\n${
        parseResult.errors.map(e => `  [${e.section}] ${e.message}`).join("\n")
      }`,
    )
  }

  const data = parseResult.data!
  const now = new Date().toISOString()
  const artifactId = randomUUID()
  const version = options.version ?? 1
  const contentHash = computeArtifactHash(markdown)

  const acts = data.acts.map(act => ({
    title: act.title,
    summary: `Goals: ${act.goals}\nStakes: ${act.stakes}\nKey Events: ${act.keyEvents}`,
  }))

  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId,
    runId: run.runId,
    createdAt: now,
    stage: "rough_outline_draft",
    sourceArtifactIds: options.sourceArtifactIds ?? [],
    status: options.status ?? "draft",
    logline: data.premiseLogline,
    acts,
    contentHash,
    version,
  }
}

// -- Detailed Outline --

export function compileDetailedOutlineFromMarkdown(
  markdown: string,
  run: RunState,
  options: CompileOutlineOptions,
): DetailedOutlineArtifact {
  const parseResult = parseDetailedOutline(markdown)
  if (parseResult.errors.length > 0) {
    throw new Error(
      `Detailed outline markdown parsing failed:\n${
        parseResult.errors.map(e => `  [${e.section}] ${e.message}`).join("\n")
      }`,
    )
  }

  const data = parseResult.data!
  const now = new Date().toISOString()
  const artifactId = randomUUID()
  const version = options.version ?? 1
  const contentHash = computeArtifactHash(markdown)

  const chapters = data.chapters.map(ch => ({
    chapterNumber: ch.chapterNumber,
    title: ch.title,
    synopsis: ch.synopsis,
    keyEvents: ch.keyEvents.split("\n").map(s => s.replace(/^-\s*/, "").trim()).filter(Boolean),
  }))

  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId,
    runId: run.runId,
    createdAt: now,
    stage: "detailed_outline_draft",
    sourceArtifactIds: options.sourceArtifactIds ?? [],
    status: options.status ?? "draft",
    chapters,
    contentHash,
    version,
  }
}

// -- Character Sheets --

export function compileCharacterSheets(
  characterData: CharacterSheet[],
  run: RunState,
  options: { markdownPath: string } & CompileOutlineOptions,
): CharacterCompilationResult {
  const now = new Date().toISOString()
  const artifactId = randomUUID()

  return {
    artifactId,
    characters: characterData,
    markdownPath: options.markdownPath,
    compiledAt: now,
    fileCount: characterData.length,
  }
}

// -- Draft --

export function createDraftFromApprovedEvent(
  prose: string,
  run: RunState,
  eventRef: string,
  options: DraftFromEventOptions,
): DraftArtifact {
  const now = new Date().toISOString()
  const artifactId = randomUUID()
  const version = options.version ?? 1
  const contentHash = computeArtifactHash(prose)

  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId,
    runId: run.runId,
    createdAt: now,
    stage: "prose_draft",
    sourceArtifactIds: options.sourceArtifactIds ?? [],
    status: options.status ?? "draft",
    proseContent: prose,
    factAssumptions: options.factAssumptions ?? [],
    eventReference: eventRef,
    contentHash,
    version,
  }
}

// -- Review gate set validation --

export function recordApprovedReviewSet(
  reviews: import("../schemas/review").ReviewResult[],
  artifactHash: string,
): import("../schemas/review").ReviewGateSet {
  if (reviews.length === 0) {
    throw new Error("Cannot record an empty review set")
  }

  for (const review of reviews) {
    if (review.reviewedArtifactHash !== artifactHash) {
      throw new Error(
        `Review for gate "${review.gate}" has reviewedArtifactHash "${review.reviewedArtifactHash}" ` +
        `but artifactHash "${artifactHash}" was expected. Review may be stale or for a different artifact.`,
      )
    }
    if (review.status !== "pass") {
      throw new Error(
        `Review for gate "${review.gate}" has status "${review.status}" but "pass" is required ` +
        `for gate set approval. gate="${review.gate}" status="${review.status}"`,
      )
    }
  }

  return {
    reviews,
    currentArtifactHash: artifactHash,
  }
}
