import { readFile } from "node:fs/promises"
import type { PluginInput } from "@opencode-ai/plugin"
import { NovelError, NovelErrorCode } from "../errors"
import { EvidencePackSchema, PreferenceBoundaryProfileSchema, RunStateSchema, type EvidencePack } from "../schemas"
import { projectExists, readArtifact, resolveNovelPath } from "../storage"
import { StageGraph } from "../stage-graph"

const CONTEXT_LIMIT = 6_000
const MAX_EVIDENCE_ITEMS = 8
const BOUNDARY_PROFILE_PATH = "preferences/boundaries.json"

export type CompactContextSummary = {
  activeRunId?: string
  currentStage?: string
  pendingGates?: string[]
  preferences?: {
    markdown?: string
    profile?: {
      preferredTone: string[]
      avoidedContent: string[]
      hardBoundaries: string[]
    }
  }
  evidenceSummary?: EvidenceSummaryItem[]
  hint?: string
}

export type EvidenceSummaryItem = {
  sourceId: string
  styleTraits: string[]
  tropeTags: string[]
}

type OutputPart = { type: string; text?: string; [key: string]: unknown }

type ChatMessageInput = { sessionID: string }

type ChatMessageOutput = {
  parts?: OutputPart[]
  message?: Record<string, unknown>
}

type CompactingOutput = { context: string[] }

export async function buildCompactContextSummary(projectRoot: string): Promise<CompactContextSummary> {
  if (!projectExists(projectRoot)) {
    return { hint: "novel project not initialized" }
  }

  const runArtifact = await readOptionalArtifact("runs/current.json", projectRoot)
  const run = runArtifact ? RunStateSchema.safeParse(runArtifact) : null
  if (!run?.success) {
    return { hint: "novel project not initialized" }
  }

  const [preferences, evidenceSummary] = await Promise.all([
    readPreferences(projectRoot),
    readEvidenceSummary(projectRoot, run.data.artifactIds),
  ])

  return {
    activeRunId: run.data.runId,
    currentStage: run.data.stage,
    pendingGates: StageGraph.getRequiredGates(run.data.stage),
    preferences,
    evidenceSummary,
  }
}

export function formatCompactContext(summary: CompactContextSummary): string {
  return trimToLimit(JSON.stringify({ novelContext: summary }, null, 2), CONTEXT_LIMIT)
}

export function createContextInjectorHook(ctx: PluginInput) {
  async function loadContext(): Promise<string> {
    return formatCompactContext(await buildCompactContextSummary(ctx.directory))
  }

  return {
    "chat.message": async (_input: ChatMessageInput, output: ChatMessageOutput): Promise<void> => {
      const textPart = output.parts?.find((part) => part.type === "text" && part.text !== undefined)
      if (!textPart) {
        return
      }

      textPart.text = `${await loadContext()}\n\n---\n\n${textPart.text ?? ""}`
    },

    "experimental.session.compacting": async (_input: { sessionID: string }, output: CompactingOutput): Promise<void> => {
      output.context.push(await loadContext())
    },
  }
}

async function readPreferences(projectRoot: string): Promise<CompactContextSummary["preferences"]> {
  const [markdown, profileArtifact] = await Promise.all([
    readOptionalText("preferences.md", projectRoot),
    readOptionalArtifact(BOUNDARY_PROFILE_PATH, projectRoot),
  ])
  const profile = profileArtifact ? PreferenceBoundaryProfileSchema.safeParse(profileArtifact) : null

  const preferences: CompactContextSummary["preferences"] = {}
  const compactMarkdown = compactPreferenceMarkdown(markdown)
  if (compactMarkdown) {
    preferences.markdown = compactMarkdown
  }
  if (profile?.success) {
    preferences.profile = {
      preferredTone: profile.data.preferredTone,
      avoidedContent: profile.data.avoidedContent,
      hardBoundaries: profile.data.hardBoundaries,
    }
  }

  return Object.keys(preferences).length > 0 ? preferences : undefined
}

async function readEvidenceSummary(projectRoot: string, artifactIds: string[]): Promise<EvidenceSummaryItem[]> {
  const summaries: EvidenceSummaryItem[] = []
  for (const artifactId of artifactIds) {
    if (summaries.length >= MAX_EVIDENCE_ITEMS) {
      break
    }

    const artifact = await readOptionalArtifact(`corpus/evidence-packs/${artifactId}.json`, projectRoot)
    const evidencePack = artifact ? EvidencePackSchema.safeParse(artifact) : null
    if (!evidencePack?.success) {
      continue
    }

    summaries.push(...summarizeEvidencePack(evidencePack.data).slice(0, MAX_EVIDENCE_ITEMS - summaries.length))
  }

  return summaries
}

function summarizeEvidencePack(pack: EvidencePack): EvidenceSummaryItem[] {
  return pack.sourceIds.map((sourceId) => ({
    sourceId,
    styleTraits: selectTags(pack.claims.map((claim) => claim.claim), ["style", "tone", "voice", "pacing", "prose"]),
    tropeTags: selectTags(pack.claims.map((claim) => claim.claim), ["trope", "arc", "conflict", "romance", "mystery", "quest"]),
  }))
}

function selectTags(claims: string[], keywords: string[]): string[] {
  const tags = new Set<string>()
  for (const claim of claims) {
    const normalized = claim.toLowerCase()
    for (const keyword of keywords) {
      if (normalized.includes(keyword)) {
        tags.add(keyword)
      }
    }
  }
  return Array.from(tags).slice(0, 6)
}

function compactPreferenceMarkdown(markdown: string | null): string | undefined {
  const lines = markdown
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line !== "# Preferences")
    .slice(0, 12)
  return lines && lines.length > 0 ? lines.join("\n") : undefined
}

async function readOptionalArtifact(path: string, projectRoot: string): Promise<unknown | null> {
  try {
    return await readArtifact(path, projectRoot)
  } catch (error) {
    if (error instanceof NovelError && error.code === NovelErrorCode.ARTIFACT_CORRUPT) {
      return null
    }
    throw error
  }
}

async function readOptionalText(path: string, projectRoot: string): Promise<string | null> {
  try {
    return await readFile(resolveNovelPath(path, projectRoot), "utf8")
  } catch {
    return null
  }
}


function trimToLimit(value: string, limit: number): string {
  if (value.length <= limit) {
    return value
  }
  return `${value.slice(0, limit - 32)}\n...[compact context truncated]`
}

