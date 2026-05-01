import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SCHEMA_VERSION, type RunState } from "../../schemas"
import { initNovelProject, readArtifact, writeArtifact } from "../../storage"
import { chunkByteSize, defaultIngestChunk, splitTextIntoChunks, stageAndIngest, type ChunkProvenance } from ".."

const createdAt = "2026-05-01T00:00:00.000Z"

let projectRoot: string

function runState(stage: RunState["stage"]): RunState {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: "run-ingest-1",
    projectId: "project-ingest-1",
    stage,
    artifactIds: [],
    updatedAt: createdAt,
  }
}

describe("auto ingest pipeline", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-ingest-pipeline-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("splitTextIntoChunks preserves order and stays under the byte limit", () => {
    const paragraphA = "# Chapter One\n" + "alpha ".repeat(40) + "\n\n"
    const paragraphB = "beta ".repeat(45) + "\n"
    const paragraphC = "gamma ".repeat(45)
    const text = paragraphA + paragraphB + "\n" + paragraphC

    const chunks = splitTextIntoChunks(text, 150)

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.map((chunk) => chunk.order)).toEqual(Array.from({ length: chunks.length }, (_, index) => index + 1))
    expect(chunks.every((chunk) => chunkByteSize(chunk.content) <= 150)).toBe(true)
    expect(chunks.map((chunk) => chunk.content).join("")).toBe(text)
    expect(chunks.every((chunk) => chunk.contentHash.length === 64)).toBe(true)
  })

  test("stageAndIngest stages chunk files and sequentially ingests them", async () => {
    const project = await initNovelProject(projectRoot)
    const run = { ...runState("event_selection"), projectId: project.projectId }
    await writeArtifact("runs/current.json", run, projectRoot)
    const text = [
      "# Chapter One\n" + "courier ".repeat(80),
      "\n\n",
      "# Chapter Two\n" + "thunder ".repeat(80),
      "\n\n",
      "# Chapter Three\n" + "promise ".repeat(80),
    ].join("")

    const result = await stageAndIngest(text, projectRoot, run, { maxChunkBytes: 700 })

    expect(result.chunkCount).toBe(3)
    expect(result.ingested).toBe(3)
    expect(result.skipped).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.results.map((chunk) => chunk.status)).toEqual(["ingested", "ingested", "ingested"])
    expect(result.currentRun.artifactIds).toHaveLength(3)

    const chunkPath = join(projectRoot, "authored", "ingest-chunks", "chunk-001.md")
    const metadataPath = join(projectRoot, "authored", "ingest-chunks", "chunk-001.meta.json")
    expect(readFileSync(chunkPath, "utf8")).toContain("# Chapter One")
    const metadata = JSON.parse(readFileSync(metadataPath, "utf8")) as ChunkProvenance
    expect(metadata.status).toBe("ingested")
    expect(metadata.sourceTextHash).toBe(result.sourceTextHash)
    expect(metadata.chunkOrder).toBe(1)

    const evidence = await readArtifact(`corpus/evidence-packs/${result.results[0].evidencePackId}.json`, projectRoot) as { sourceIds: string[] }
    expect(evidence.sourceIds).toHaveLength(1)
  })

  test("stageAndIngest skips repeated chunk hashes", async () => {
    const project = await initNovelProject(projectRoot)
    const run = { ...runState("event_selection"), projectId: project.projectId }
    await writeArtifact("runs/current.json", run, projectRoot)
    const repeatedChunk = "repeat this proof block\nrepeat this proof block\n\n"
    const text = repeatedChunk.repeat(3)

    const result = await stageAndIngest(text, projectRoot, run, { maxChunkBytes: chunkByteSize(repeatedChunk) })

    expect(result.results.map((chunk) => chunk.status)).toEqual(["ingested", "skipped", "skipped"])
    expect(result.results[1].reason).toBe("duplicate_hash")
    expect(result.currentRun.artifactIds).toHaveLength(1)
    const metadata = JSON.parse(readFileSync(join(projectRoot, "authored", "ingest-chunks", "chunk-002.meta.json"), "utf8")) as Record<string, string>
    expect(metadata.status).toBe("skipped")
    expect(metadata.reason).toBe("duplicate_hash")
  })

  test("stageAndIngest preserves prior ingests when a mid-sequence failure occurs", async () => {
    const project = await initNovelProject(projectRoot)
    const run = { ...runState("event_selection"), projectId: project.projectId }
    await writeArtifact("runs/current.json", run, projectRoot)
    const text = [
      "# One\n" + "first ".repeat(70),
      "\n\n",
      "# Two\n" + "second ".repeat(70),
      "\n\n",
      "# Three\n" + "third ".repeat(70),
    ].join("")

    const result = await stageAndIngest(text, projectRoot, run, {
      maxChunkBytes: 500,
      ingestChunk: async (context) => {
        if (context.stagedChunk.order === 2) {
          throw new Error("Injected ingest failure")
        }
        return defaultIngestChunk(context)
      },
    })

    expect(result.results.map((chunk) => chunk.status)).toEqual(["ingested", "failed", "not_started"])
    expect(result.failed).toBe(1)
    expect(result.currentRun.artifactIds).toHaveLength(1)

    const persistedRun = await readArtifact("runs/current.json", projectRoot) as RunState
    expect(persistedRun.artifactIds).toHaveLength(1)

    const failedMetadata = JSON.parse(readFileSync(join(projectRoot, "authored", "ingest-chunks", "chunk-002.meta.json"), "utf8")) as ChunkProvenance
    const pendingMetadata = JSON.parse(readFileSync(join(projectRoot, "authored", "ingest-chunks", "chunk-003.meta.json"), "utf8")) as ChunkProvenance
    expect(failedMetadata.status).toBe("failed")
    expect(failedMetadata.error).toContain("Injected ingest failure")
    expect(pendingMetadata.status).toBe("not_started")
  })
})
