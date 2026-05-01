import type { RunState } from "../schemas"

export const DEFAULT_MAX_CHUNK_BYTES = 1500
export const INGEST_CHUNKS_DIR = "authored/ingest-chunks"

export type ChunkIngestStatus = "staged" | "ingested" | "skipped" | "failed" | "not_started"
export type ChunkSkipReason = "duplicate_hash"

export interface TextChunk {
  order: number
  content: string
  contentHash: string
  byteSize: number
}

export interface ChunkProvenance {
  sourceTextHash: string
  chunkOrder: number
  chunkHash: string
  byteSize: number
  chunkPath: string
  metadataPath: string
  status: ChunkIngestStatus
  createdAt: string
  sourceId?: string
  evidencePackId?: string
  reason?: ChunkSkipReason
  error?: string
}

export interface StagedChunk extends TextChunk {
  sourceTextHash: string
  chunkPath: string
  absoluteChunkPath: string
  metadataPath: string
  absoluteMetadataPath: string
}

export interface ChunkIngestResult extends StagedChunk {
  status: ChunkIngestStatus
  sourceId?: string
  evidencePackId?: string
  reason?: ChunkSkipReason
  error?: string
}

export interface IngestResult {
  sourceTextHash: string
  chunkCount: number
  ingested: number
  skipped: number
  failed: number
  results: ChunkIngestResult[]
  currentRun: RunState
}

export interface ChunkIngestContext {
  stagedChunk: StagedChunk
  root: string
  run: RunState
  authorizationNote?: string
  seenHashes: Set<string>
  defaultIngest: (context: DefaultChunkIngestContext) => Promise<DefaultChunkIngestResult>
}

export interface StageAndIngestOptions {
  authorizationNote?: string
  maxChunkBytes?: number
  ingestChunk?: (context: ChunkIngestContext) => Promise<DefaultChunkIngestResult>
}

export interface DefaultChunkIngestContext {
  stagedChunk: StagedChunk
  root: string
  run: RunState
  authorizationNote?: string
  seenHashes: Set<string>
}

export interface DefaultChunkIngestResult {
  status: "ingested" | "skipped"
  sourceId?: string
  evidencePackId?: string
  reason?: ChunkSkipReason
  run: RunState
}
