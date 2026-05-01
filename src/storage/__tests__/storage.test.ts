import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NovelError, NovelErrorCode } from "../../errors"
import { SCHEMA_VERSION, type RunState } from "../../schemas"
import { initNovelProject, projectExists, readArtifact, resolveNovelPath, writeArtifact } from ".."

let projectRoot: string

describe("storage", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-storage-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("initNovelProject creates required novel layout in a temp directory", async () => {
    // #given
    const requiredPaths = [
      ".novel/project.json",
      ".novel/preferences.md",
      ".novel/canon",
      ".novel/canon/facts.json",
      ".novel/canon/characters.json",
      ".novel/canon/world.json",
      ".novel/canon/timeline.json",
      ".novel/canon/style.md",
      ".novel/corpus/evidence-packs",
      ".novel/corpus/sources",
      ".novel/outlines/rough",
      ".novel/outlines/detailed",
      ".novel/runs",
      ".novel/drafts",
      ".novel/logs/decisions.md",
    ]

    // #when
    const project = await initNovelProject(projectRoot)

    // #then
    expect(project.schemaVersion).toBe(SCHEMA_VERSION)
    expect(projectExists(projectRoot)).toBe(true)
    for (const path of requiredPaths) {
      expect(existsSync(join(projectRoot, path))).toBe(true)
    }
    expect(JSON.parse(readFileSync(join(projectRoot, ".novel/canon/facts.json"), "utf8"))).toEqual([])
    expect(JSON.parse(readFileSync(join(projectRoot, ".novel/canon/characters.json"), "utf8"))).toEqual([])
    expect(JSON.parse(readFileSync(join(projectRoot, ".novel/canon/world.json"), "utf8"))).toEqual({})
    expect(JSON.parse(readFileSync(join(projectRoot, ".novel/canon/timeline.json"), "utf8"))).toEqual([])
  })

  test("initNovelProject is deterministic and does not overwrite existing artifacts", async () => {
    // #given
    const firstProject = await initNovelProject(projectRoot)
    const preferencesPath = join(projectRoot, ".novel", "preferences.md")
    const decisionsPath = join(projectRoot, ".novel", "logs", "decisions.md")
    writeFileSync(preferencesPath, "custom preferences", "utf8")
    writeFileSync(decisionsPath, "custom decision log", "utf8")

    // #when
    const secondProject = await initNovelProject(projectRoot)

    // #then
    expect(secondProject).toEqual(firstProject)
    expect(readFileSync(preferencesPath, "utf8")).toBe("custom preferences")
    expect(readFileSync(decisionsPath, "utf8")).toBe("custom decision log")
  })

  test("initNovelProject reports corrupt existing project.json without overwriting", async () => {
    // #given
    await initNovelProject(projectRoot)
    const projectPath = join(projectRoot, ".novel", "project.json")
    writeFileSync(projectPath, "{ broken", "utf8")

    // #when / #then
    try {
      await initNovelProject(projectRoot)
      throw new Error("Expected corrupt project error")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.ARTIFACT_CORRUPT)
        expect(error.message).toContain(projectPath)
      }
    }
    expect(readFileSync(projectPath, "utf8")).toBe("{ broken")
  })

  test("resolveNovelPath rejects traversal and absolute paths", async () => {
    // #given
    await initNovelProject(projectRoot)
    const unsafePaths = ["../outside.md", ".novel/../../secrets.txt", "/etc/passwd"]

    // #when / #then
    for (const unsafePath of unsafePaths) {
      expect(() => resolveNovelPath(unsafePath, projectRoot)).toThrow(NovelError)
      try {
        resolveNovelPath(unsafePath, projectRoot)
        throw new Error("Expected path error")
      } catch (error) {
        expect(error).toBeInstanceOf(NovelError)
        if (error instanceof NovelError) {
          expect(error.code).toBe(NovelErrorCode.PATH_OUTSIDE_NOVEL_ROOT)
        }
      }
    }
  })

  test("readArtifact reports corrupted JSON with code and path without overwriting", async () => {
    // #given
    await initNovelProject(projectRoot)
    const corruptPath = join(projectRoot, ".novel", "runs", "current.json")
    writeFileSync(corruptPath, "{ invalid json", "utf8")

    // #when / #then
    try {
      await readArtifact("runs/current.json", projectRoot)
      throw new Error("Expected corrupt artifact error")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.ARTIFACT_CORRUPT)
        expect(error.message).toContain(corruptPath)
        expect(error.message).toContain("invalid JSON")
      }
    }
    expect(readFileSync(corruptPath, "utf8")).toBe("{ invalid json")
  })

  test("readArtifact reports unsupported schema artifacts without overwriting", async () => {
    // #given
    await initNovelProject(projectRoot)
    const unsupportedPath = join(projectRoot, ".novel", "runs", "current.json")
    writeFileSync(unsupportedPath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, unknown: true }), "utf8")

    // #when / #then
    try {
      await readArtifact("runs/current.json", projectRoot)
      throw new Error("Expected unsupported artifact error")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.ARTIFACT_CORRUPT)
        expect(error.message).toContain(unsupportedPath)
        expect(error.message).toContain("supported schema")
      }
    }
    expect(JSON.parse(readFileSync(unsupportedPath, "utf8"))).toEqual({ schemaVersion: SCHEMA_VERSION, unknown: true })
  })

  test("writeArtifact validates and atomically writes known JSON artifacts", async () => {
    // #given
    const project = await initNovelProject(projectRoot)
    const runState: RunState = {
      schemaVersion: SCHEMA_VERSION,
      runId: "run-1",
      projectId: project.projectId,
      stage: "interviewing",
      artifactIds: [],
      updatedAt: "2026-05-01T00:00:00.000Z",
    }

    // #when
    await writeArtifact("runs/current.json", runState, projectRoot)
    const artifact = await readArtifact("runs/current.json", projectRoot)

    // #then
    expect(artifact).toEqual(runState)
    expect(readFileSync(join(projectRoot, ".novel", "runs", "current.json"), "utf8")).toContain('\n  "runId": "run-1"')
  })

  test("read and write require an initialized project", async () => {
    // #given
    const runState: RunState = {
      schemaVersion: SCHEMA_VERSION,
      runId: "run-1",
      projectId: "project-1",
      stage: "interviewing",
      artifactIds: [],
      updatedAt: "2026-05-01T00:00:00.000Z",
    }

    // #when / #then
    await expect(readArtifact("runs/current.json", projectRoot)).rejects.toThrow(NovelError)
    await expect(writeArtifact("runs/current.json", runState, projectRoot)).rejects.toThrow(NovelError)
    try {
      await writeArtifact("runs/current.json", runState, projectRoot)
      throw new Error("Expected project initialization error")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.PROJECT_NOT_INITIALIZED)
      }
    }
  })
})
