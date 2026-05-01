import { randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { NovelError, NovelErrorCode } from "../errors"
import {
  CorpusSourceSchema,
  EvidencePackSchema,
  SCHEMA_VERSION,
  type AbstractEvidence,
  type ChapterDetection,
  type RunState,
  type SceneFunction,
} from "../schemas"
import { computeArtifactHash } from "../schemas/review"
import { readArtifact, resolveNovelPath, writeArtifact } from "../storage"
import { AUTHORED_DIR } from "../authoring/types"
import { addRunArtifact, writeCurrentRun } from "../tools/common"
import { splitTextIntoChunks } from "./chunker"
import {
  DEFAULT_MAX_CHUNK_BYTES,
  INGEST_CHUNKS_DIR,
  type ChunkIngestContext,
  type ChunkIngestResult,
  type ChunkProvenance,
  type DefaultChunkIngestContext,
  type DefaultChunkIngestResult,
  type IngestResult,
  type StageAndIngestOptions,
  type StagedChunk,
} from "./types"

const MAX_FILE_BYTES_GUARD = 2 * 1024 * 1024
const SUPPORTED_EXTENSIONS = new Set([".txt", ".md"])

type ExistingSource = {
  sourceId: string
  contentHash: string
}

const encoder = new TextEncoder()

export async function stageAndIngest(text: string, root: string, run: RunState, options: StageAndIngestOptions = {}): Promise<IngestResult> {
  const maxChunkBytes = options.maxChunkBytes ?? DEFAULT_MAX_CHUNK_BYTES
  const sourceTextHash = computeArtifactHash(text)
  const stagedChunks = await stageChunkFiles(text, root, sourceTextHash, maxChunkBytes)
  const existingSources = await readExistingSources(root)
  const seenHashes = new Set(existingSources.map((source) => source.contentHash))
  const ingestChunk = options.ingestChunk ?? defaultIngestChunk
  let currentRun = run
  let failed = 0
  const results: ChunkIngestResult[] = []

  for (let index = 0; index < stagedChunks.length; index += 1) {
    const stagedChunk = stagedChunks[index]
    try {
      const result = await ingestChunk({
        stagedChunk,
        root,
        run: currentRun,
        authorizationNote: options.authorizationNote,
        seenHashes,
        defaultIngest: defaultIngestChunk,
      })

      currentRun = result.run
      const chunkResult: ChunkIngestResult = {
        ...stagedChunk,
        status: result.status,
        sourceId: result.sourceId,
        evidencePackId: result.evidencePackId,
        reason: result.reason,
      }
      results.push(chunkResult)
      await writeChunkMetadata(stagedChunk, {
        sourceTextHash,
        chunkOrder: stagedChunk.order,
        chunkHash: stagedChunk.contentHash,
        byteSize: stagedChunk.byteSize,
        chunkPath: stagedChunk.chunkPath,
        metadataPath: stagedChunk.metadataPath,
        status: result.status,
        createdAt: new Date().toISOString(),
        sourceId: result.sourceId,
        evidencePackId: result.evidencePackId,
        reason: result.reason,
      })
    } catch (error) {
      failed += 1
      const message = formatCause(error)
      const failedResult: ChunkIngestResult = {
        ...stagedChunk,
        status: "failed",
        error: message,
      }
      results.push(failedResult)
      await writeChunkMetadata(stagedChunk, {
        sourceTextHash,
        chunkOrder: stagedChunk.order,
        chunkHash: stagedChunk.contentHash,
        byteSize: stagedChunk.byteSize,
        chunkPath: stagedChunk.chunkPath,
        metadataPath: stagedChunk.metadataPath,
        status: "failed",
        createdAt: new Date().toISOString(),
        error: message,
      })

      for (let pendingIndex = index + 1; pendingIndex < stagedChunks.length; pendingIndex += 1) {
        const pendingChunk = stagedChunks[pendingIndex]
        const pendingResult: ChunkIngestResult = {
          ...pendingChunk,
          status: "not_started",
        }
        results.push(pendingResult)
        await writeChunkMetadata(pendingChunk, {
          sourceTextHash,
          chunkOrder: pendingChunk.order,
          chunkHash: pendingChunk.contentHash,
          byteSize: pendingChunk.byteSize,
          chunkPath: pendingChunk.chunkPath,
          metadataPath: pendingChunk.metadataPath,
          status: "not_started",
          createdAt: new Date().toISOString(),
        })
      }
      break
    }
  }

  return {
    sourceTextHash,
    chunkCount: stagedChunks.length,
    ingested: results.filter((result) => result.status === "ingested").length,
    skipped: results.filter((result) => result.status === "skipped").length,
    failed,
    results,
    currentRun,
  }
}

export async function stageChunkFiles(text: string, root: string, sourceTextHash: string, maxChunkBytes = DEFAULT_MAX_CHUNK_BYTES): Promise<StagedChunk[]> {
  const chunkDirectory = resolve(root, AUTHORED_DIR, "ingest-chunks")
  await mkdir(chunkDirectory, { recursive: true })
  await removeManagedChunkFiles(chunkDirectory)

  const createdAt = new Date().toISOString()
  const chunks = splitTextIntoChunks(text, maxChunkBytes)
  const stagedChunks: StagedChunk[] = []

  for (const chunk of chunks) {
    const chunkNumber = String(chunk.order).padStart(3, "0")
    const chunkFilename = `chunk-${chunkNumber}.md`
    const metadataFilename = `chunk-${chunkNumber}.meta.json`
    const absoluteChunkPath = resolve(chunkDirectory, chunkFilename)
    const absoluteMetadataPath = resolve(chunkDirectory, metadataFilename)
    const chunkPath = join(INGEST_CHUNKS_DIR, chunkFilename)
    const metadataPath = join(INGEST_CHUNKS_DIR, metadataFilename)
    const stagedChunk: StagedChunk = {
      ...chunk,
      sourceTextHash,
      chunkPath,
      absoluteChunkPath,
      metadataPath,
      absoluteMetadataPath,
    }

    await writeFile(absoluteChunkPath, chunk.content, "utf8")
    await writeChunkMetadata(stagedChunk, {
      sourceTextHash,
      chunkOrder: chunk.order,
      chunkHash: chunk.contentHash,
      byteSize: chunk.byteSize,
      chunkPath,
      metadataPath,
      status: "staged",
      createdAt,
    })
    stagedChunks.push(stagedChunk)
  }

  return stagedChunks
}

export async function defaultIngestChunk(context: DefaultChunkIngestContext): Promise<DefaultChunkIngestResult> {
  const { stagedChunk, root, run, authorizationNote, seenHashes } = context
  const extension = stagedChunk.chunkPath.endsWith(".md") ? ".md" : ".txt"
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new NovelError(NovelErrorCode.UNSUPPORTED_CORPUS_FILE_TYPE, `Unsupported corpus file type ${extension || "<none>"}; only .txt and .md are accepted`)
  }

  const absolutePath = resolve(root, stagedChunk.chunkPath)
  const fileStat = await stat(absolutePath)
  if (!fileStat.isFile()) {
    throw new NovelError(NovelErrorCode.UNSUPPORTED_CORPUS_FILE_TYPE, `Corpus path is not a file: ${stagedChunk.chunkPath}`)
  }
  if (fileStat.size > MAX_FILE_BYTES_GUARD) {
    throw new NovelError(NovelErrorCode.CORPUS_FILE_TOO_LARGE, `Corpus file ${stagedChunk.chunkPath} is ${fileStat.size} bytes; limit is ${MAX_FILE_BYTES_GUARD}`)
  }

  const content = await readFile(absolutePath, "utf8")
  const contentHash = computeArtifactHash(content)
  const filename = basename(stagedChunk.chunkPath)
  if (seenHashes.has(contentHash)) {
    return { status: "skipped", reason: "duplicate_hash", run }
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
    authorizationNote,
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
  const updatedRun = addRunArtifact(run, evidencePackId)
  await writeCurrentRun(updatedRun, root)
  return { status: "ingested", sourceId, evidencePackId, run: updatedRun }
}

async function removeManagedChunkFiles(chunkDirectory: string): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(chunkDirectory)
  } catch {
    return
  }

  await Promise.all(entries.map(async (entry) => {
    if (!/^chunk-\d{3}(\.md|\.meta\.json)$/.test(entry)) {
      return
    }
    await rm(resolve(chunkDirectory, entry), { force: true })
  }))
}

async function writeChunkMetadata(stagedChunk: StagedChunk, metadata: ChunkProvenance): Promise<void> {
  await writeFile(stagedChunk.absoluteMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8")
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
  for (let start = 0; start < content.length; start += 4500) {
    chunks.push(content.slice(start, start + 4500))
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

function formatCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function chunkByteSize(content: string): number {
  return encoder.encode(content).length
}
