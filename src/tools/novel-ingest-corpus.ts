import { readdir, readFile, stat } from "node:fs/promises"
import { basename, extname, resolve } from "node:path"
import { randomUUID } from "node:crypto"
import { tool } from "@opencode-ai/plugin"
import { NovelError, NovelErrorCode } from "../errors"
import { computeArtifactHash, CorpusSourceSchema, EvidencePackSchema, SCHEMA_VERSION, type AbstractEvidence, type ChapterDetection, type SceneFunction } from "../schemas"
import { readArtifact, resolveNovelPath, writeArtifact } from "../storage"
import { addRunArtifact, assertInitialized, jsonResult, projectRoot, requireCurrentRun, writeCurrentRun } from "./common"

const DEFAULT_MAX_FILES = 5
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024
const DEFAULT_MAX_TOTAL_BYTES = 10 * 1024 * 1024
const MAX_FILES_GUARD = 5
const MAX_FILE_BYTES_GUARD = 2 * 1024 * 1024
const MAX_TOTAL_BYTES_GUARD = 10 * 1024 * 1024
const CHUNK_SIZE = 4500
const SUPPORTED_EXTENSIONS = new Set([".txt", ".md"])

type IngestResult = {
  filePath: string
  filename: string
  status: "ingested" | "skipped"
  sourceId?: string
  evidencePackId?: string
  contentHash?: string
  reason?: "duplicate_hash"
}

type ExistingSource = {
  sourceId: string
  contentHash: string
}

export function createNovelIngestCorpusTool() {
  return tool({
    description: `Ingest authorized local .txt or .md corpus files into abstract evidence packs.

Use for local reference corpus ingestion only after confirming authorization. Remote URLs, binary files, unsupported extensions, and source text retention are intentionally rejected.
Accepted inputs: up to five local .txt/.md file paths plus optional authorization note and guarded limit overrides.
Outputs: per-file ingest/skipped status, source metadata ids, and abstract evidence pack ids.
Recovery: use supported text files under size limits; duplicates by content hash are skipped rather than re-ingested.`,
    args: {
      files: tool.schema.array(tool.schema.string().min(1)).min(1).max(MAX_FILES_GUARD).describe("Local .txt or .md files to ingest."),
      authorizationNote: tool.schema.string().min(1).optional().describe("Optional note confirming the files are authorized for local analysis."),
      limits: tool.schema.object({
        maxFiles: tool.schema.number().int().positive().max(MAX_FILES_GUARD).optional(),
        maxFileBytes: tool.schema.number().int().positive().max(MAX_FILE_BYTES_GUARD).optional(),
        maxTotalBytes: tool.schema.number().int().positive().max(MAX_TOTAL_BYTES_GUARD).optional(),
      }).optional().describe("Optional stricter ingest limits. Overrides cannot exceed guarded defaults."),
    },
    async execute(args, ctx) {
      const root = projectRoot(ctx)
      assertInitialized(root)
      const run = await requireCurrentRun(root)
      const limits = normalizeLimits(args.limits)
      const files = args.files
      if (files.length > limits.maxFiles) {
        throw new NovelError(NovelErrorCode.CORPUS_FILE_TOO_LARGE, `Corpus ingest accepts at most ${limits.maxFiles} files`)
      }

      const existingSources = await readExistingSources(root)
      const seenHashes = new Set(existingSources.map((source) => source.contentHash))
      let totalBytes = 0
      let updatedRun = run
      const results: IngestResult[] = []

      for (const filePath of files) {
        const extension = extname(filePath).toLowerCase()
        if (!SUPPORTED_EXTENSIONS.has(extension)) {
          throw new NovelError(NovelErrorCode.UNSUPPORTED_CORPUS_FILE_TYPE, `Unsupported corpus file type ${extension || "<none>"}; only .txt and .md are accepted`)
        }

        const absolutePath = resolve(root, filePath)
        const fileStat = await stat(absolutePath)
        if (!fileStat.isFile()) {
          throw new NovelError(NovelErrorCode.UNSUPPORTED_CORPUS_FILE_TYPE, `Corpus path is not a file: ${filePath}`)
        }
        if (fileStat.size > limits.maxFileBytes) {
          throw new NovelError(NovelErrorCode.CORPUS_FILE_TOO_LARGE, `Corpus file ${filePath} is ${fileStat.size} bytes; limit is ${limits.maxFileBytes}`)
        }
        totalBytes += fileStat.size
        if (totalBytes > limits.maxTotalBytes) {
          throw new NovelError(NovelErrorCode.CORPUS_FILE_TOO_LARGE, `Corpus ingest total is ${totalBytes} bytes; limit is ${limits.maxTotalBytes}`)
        }

        const content = await readFile(absolutePath, "utf8")
        const contentHash = computeArtifactHash(content)
        const filename = basename(filePath)
        if (seenHashes.has(contentHash)) {
          results.push({ filePath, filename, status: "skipped", contentHash, reason: "duplicate_hash" })
          continue
        }
        seenHashes.add(contentHash)

        const sourceId = `source-${randomUUID()}`
        const evidencePackId = `evidence-${randomUUID()}`
        const importedAt = new Date().toISOString()
        const source = CorpusSourceSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          sourceId,
          projectId: run.projectId,
          kind: "reference",
          title: filename,
          contentHash,
          filename,
          byteSize: fileStat.size,
          importedAt,
          authorizationNote: args.authorizationNote,
          createdAt: importedAt,
        })
        const abstractEvidence = analyzeSource(sourceId, content)
        const evidencePack = EvidencePackSchema.parse({
          schemaVersion: SCHEMA_VERSION,
          artifactId: evidencePackId,
          runId: run.runId,
          createdAt: importedAt,
          stage: "event_selection",
          sourceArtifactIds: [sourceId],
          status: "draft",
          sourceIds: [sourceId],
          claims: buildAbstractClaims(sourceId, abstractEvidence),
          abstractEvidence: [abstractEvidence],
        })

        await writeArtifact(`corpus/sources/${sourceId}.json`, source, root)
        await writeArtifact(`corpus/evidence-packs/${evidencePackId}.json`, evidencePack, root)
        updatedRun = addRunArtifact(updatedRun, evidencePackId)
        results.push({ filePath, filename, status: "ingested", sourceId, evidencePackId, contentHash })
      }

      if (updatedRun !== run) {
        await writeCurrentRun(updatedRun, root)
      }

      return jsonResult({ ingested: results.filter((result) => result.status === "ingested").length, skipped: results.filter((result) => result.status === "skipped").length, results, currentRun: updatedRun })
    },
  })
}

function normalizeLimits(limits: { maxFiles?: number; maxFileBytes?: number; maxTotalBytes?: number } | undefined) {
  return {
    maxFiles: Math.min(limits?.maxFiles ?? DEFAULT_MAX_FILES, MAX_FILES_GUARD),
    maxFileBytes: Math.min(limits?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES, MAX_FILE_BYTES_GUARD),
    maxTotalBytes: Math.min(limits?.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES, MAX_TOTAL_BYTES_GUARD),
  }
}

async function readExistingSources(root: string): Promise<ExistingSource[]> {
  let entries: string[]
  try {
    entries = await readdir(resolveNovelPath("corpus/sources", root))
  } catch {
    return []
  }

  const sources: ExistingSource[] = []
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue
    try {
      const artifact = await readArtifact(`corpus/sources/${entry}`, root)
      const parsed = CorpusSourceSchema.safeParse(artifact)
      if (parsed.success) {
        sources.push({ sourceId: parsed.data.sourceId, contentHash: parsed.data.contentHash })
      }
    } catch {
      continue
    }
  }
  return sources
}

function analyzeSource(sourceId: string, content: string): AbstractEvidence {
  const paragraphs = content.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
  const chunks = detectChunks(content)
  const dialogueCount = countMatches(content, /[“”"「」『』]/g) + countMatches(content, /^\s*[-—].+/gm)
  const actionCount = countMatches(content, /冲|跑|追|打|推|抓|闪|跃|杀|战|落|撞|拔|挥|躲|attack|run|fight|chase|strike|move/gi)
  const narrationCount = Math.max(paragraphs.length, 1)
  const ratioTotal = dialogueCount + actionCount + narrationCount
  const dialogueRatio = roundRatio(dialogueCount / ratioTotal)
  const actionRatio = roundRatio(actionCount / ratioTotal)
  const narrationRatio = roundRatio(Math.max(0, 1 - dialogueRatio - actionRatio))

  return {
    sourceId,
    chunkCount: chunks.length,
    chapterDetection: detectChapterMode(content),
    pacingSummary: summarizePacing(paragraphs, content),
    styleTraits: detectStyleTraits(content, paragraphs, dialogueRatio),
    tropeTags: detectTropeTags(content),
    dialogueRatio,
    actionRatio,
    narrationRatio,
    sceneFunctions: detectSceneFunctions(content),
  }
}

function detectChunks(content: string): string[] {
  const chapterMatches = [...content.matchAll(/^(#{1,2})\s+\S.*$|^第[一二三四五六七八九十百千万零〇两\d]+章\s*.*$/gm)]
  if (chapterMatches.length > 0) {
    return chapterMatches.map((match, index) => {
      const start = match.index ?? 0
      const end = chapterMatches[index + 1]?.index ?? content.length
      return content.slice(start, end)
    })
  }

  const chunks: string[] = []
  for (let index = 0; index < content.length; index += CHUNK_SIZE) {
    chunks.push(content.slice(index, index + CHUNK_SIZE))
  }
  return chunks.length ? chunks : [content]
}

function detectChapterMode(content: string): ChapterDetection {
  if (/^#{1,2}\s+\S.*$/m.test(content)) return "markdown_heading"
  if (/^第[一二三四五六七八九十百千万零〇两\d]+章\s*.*$/m.test(content)) return "numbered_chapter"
  return "none"
}

function summarizePacing(paragraphs: string[], content: string): string {
  const averageLength = paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0) / Math.max(paragraphs.length, 1)
  const sceneBreaks = countMatches(content, /^(\*\s*\*\s*\*|-{3,}|_{3,})\s*$/gm)
  const density = sceneBreaks / Math.max(paragraphs.length, 1)
  const tempo = averageLength < 80 ? "fast" : averageLength > 220 ? "slow" : "moderate"
  const segmentation = density > 0.08 ? "frequent scene breaks" : density > 0.02 ? "regular scene breaks" : "continuous scenes"
  return `${tempo} pacing with ${segmentation}`
}

function detectStyleTraits(content: string, paragraphs: string[], dialogueRatio: number): string[] {
  const sentenceParts = content.split(/[。！？!?\.]+/).map((sentence) => sentence.trim()).filter(Boolean)
  const averageSentenceLength = sentenceParts.reduce((sum, sentence) => sum + sentence.length, 0) / Math.max(sentenceParts.length, 1)
  const adjectiveDensity = countMatches(content, /清冷|幽暗|灿烂|苍白|锋利|温柔|寂静|ancient|dark|bright|cold|warm|silent|sharp/gi) / Math.max(sentenceParts.length, 1)
  const traits: string[] = []
  traits.push(averageSentenceLength < 24 ? "short-sentence rhythm" : averageSentenceLength > 60 ? "long-sentence texture" : "balanced sentence length")
  traits.push(dialogueRatio > 0.32 ? "dialogue-forward" : "narration-forward")
  if (adjectiveDensity > 0.16) traits.push("high descriptive density")
  if (paragraphs.some((paragraph) => paragraph.length < 35)) traits.push("staccato paragraphing")
  return [...new Set(traits)]
}

function detectTropeTags(content: string): string[] {
  const patterns: Array<[string, RegExp]> = [
    ["rebirth", /重生|再来一次|前世|reborn|rebirth/i],
    ["system", /系统|面板|任务奖励|system/i],
    ["cultivation", /修炼|灵气|金丹|筑基|cultivation/i],
    ["contract-marriage", /契约婚姻|协议结婚|先婚后爱/i],
    ["revenge", /复仇|报仇|雪恨|revenge/i],
    ["hidden-identity", /马甲|隐藏身份|真实身份|secret identity/i],
    ["academy", /学院|入学|同桌|academy/i],
    ["power-progression", /升级|突破|变强|level up/i],
  ]
  const tags = patterns.filter(([, pattern]) => pattern.test(content)).map(([tag]) => tag)
  return tags.length ? tags : ["general-genre-reference"]
}

function detectSceneFunctions(content: string): SceneFunction[] {
  const functions: SceneFunction[] = []
  if (/开端|醒来|初见|arrive|begin|meet/i.test(content)) functions.push("setup")
  if (/冲突|争|战|敌|fight|argue|threat/i.test(content)) functions.push("conflict")
  if (/发现|真相|秘密|reveals?|discover/i.test(content)) functions.push("revelation")
  if (/随后|于是|路上|meanwhile|then/i.test(content)) functions.push("transition")
  if (/决战|爆发|巅峰|climax/i.test(content)) functions.push("climax")
  if (/结束|平息|和解|resolve|settle/i.test(content)) functions.push("resolution")
  return functions.length ? functions : ["setup", "transition"]
}

function buildAbstractClaims(sourceId: string, evidence: AbstractEvidence) {
  return [
    { claim: `Corpus source uses ${evidence.pacingSummary}.`, sourceIds: [sourceId] },
    { claim: `Corpus source style traits: ${evidence.styleTraits.join(", ")}.`, sourceIds: [sourceId] },
    { claim: `Corpus source scene functions: ${evidence.sceneFunctions.join(", ")}.`, sourceIds: [sourceId] },
  ]
}

function countMatches(content: string, pattern: RegExp): number {
  return content.match(pattern)?.length ?? 0
}

function roundRatio(value: number): number {
  return Math.round(value * 100) / 100
}
