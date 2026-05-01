import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SCHEMA_VERSION, type EvidencePack, type PreferenceBoundaryProfile, type RunState } from "../schemas"
import { initNovelProject, writeArtifact } from "../storage"
import { buildCompactContextSummary, createContextInjectorHook, formatCompactContext } from "./context-injector"

const createdAt = "2026-05-01T00:00:00.000Z"
const sentinel = "THIS_UNIQUE_SOURCE_SENTENCE_MUST_NOT_APPEAR"

let projectRoot: string

describe("compact context injector", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-context-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("builds compact project state with run, stage, gates, preferences, and evidence summaries", async () => {
    // #given
    await seedInitializedProject()

    // #when
    const context = await buildCompactContextSummary(projectRoot)

    // #then
    expect(context.activeRunId).toBe("run-1")
    expect(context.currentStage).toBe("interviewing")
    expect(context.pendingGates).toEqual(["hasInterviewArtifact", "hasTargetAudience", "hasStoryObjective"])
    expect(context.preferences?.markdown).toContain("Prefer lyrical suspense")
    expect(context.preferences?.profile?.preferredTone).toEqual(["lyrical", "tense"])
    expect(context.evidenceSummary).toEqual([
      { sourceId: "source-1", styleTraits: ["style", "voice"], tropeTags: ["trope", "arc", "mystery", "quest"] },
    ])
  })

  test("injects compact context without raw source phrases", async () => {
    // #given
    await seedInitializedProject()
    const hook = createContextInjectorHook({ directory: projectRoot } as never)
    const output = {
      parts: [{ type: "text", text: "Draft the next scene." }],
    }

    // #when
    await hook["chat.message"]({ sessionID: "session-1" }, output)

    // #then
    expect(output.parts[0].text).toContain('"activeRunId": "run-1"')
    expect(output.parts[0].text).toContain('"currentStage": "interviewing"')
    expect(output.parts[0].text).toContain('"pendingGates"')
    expect(output.parts[0].text).toContain('"sourceId": "source-1"')
    expect(output.parts[0].text).not.toContain(sentinel)
  })

  test("adds compact context during session compaction", async () => {
    // #given
    await seedInitializedProject()
    const hook = createContextInjectorHook({ directory: projectRoot } as never)
    const output = { context: [] as string[] }

    // #when
    await hook["experimental.session.compacting"]({ sessionID: "session-1" }, output)

    // #then
    expect(output.context).toHaveLength(1)
    expect(output.context[0]).toContain('"activeRunId": "run-1"')
    expect(output.context[0]).toContain('"evidenceSummary"')
    expect(output.context[0]).not.toContain(sentinel)
  })

  test("missing novel project returns a compact not-initialized hint without crashing", async () => {
    // #given
    const hook = createContextInjectorHook({ directory: projectRoot } as never)
    const output = { parts: [{ type: "text", text: "Hello" }] }

    // #when
    const context = await buildCompactContextSummary(projectRoot)
    await hook["chat.message"]({ sessionID: "session-1" }, output)

    // #then
    expect(context).toEqual({ hint: "novel project not initialized" })
    expect(output.parts[0].text).toContain('"hint": "novel project not initialized"')
  })

  test("formatted context stays below the compact character budget", async () => {
    // #given
    await seedInitializedProject()

    // #when
    const formatted = formatCompactContext(await buildCompactContextSummary(projectRoot))

    // #then
    expect(formatted.length).toBeLessThanOrEqual(6_000)
  })
})

async function seedInitializedProject(): Promise<void> {
  const project = await initNovelProject(projectRoot)
  const run: RunState = {
    schemaVersion: SCHEMA_VERSION,
    runId: "run-1",
    projectId: project.projectId,
    stage: "interviewing",
    artifactIds: ["evidence-1"],
    updatedAt: createdAt,
  }
  const evidencePack: EvidencePack = {
    schemaVersion: SCHEMA_VERSION,
    artifactId: "evidence-1",
    runId: run.runId,
    createdAt,
    stage: "event_selection",
    sourceArtifactIds: [],
    status: "draft",
    sourceIds: ["source-1"],
    claims: [
      { claim: "Style voice stays lyrical.", sourceIds: ["source-1"] },
      { claim: "Trope quest arc escalates through mystery.", sourceIds: ["source-1"] },
    ],
  }
  const profile: PreferenceBoundaryProfile = {
    schemaVersion: SCHEMA_VERSION,
    projectId: project.projectId,
    profileId: "profile-1",
    preferredTone: ["lyrical", "tense"],
    avoidedContent: ["gratuitous gore"],
    hardBoundaries: ["no explicit sexual content"],
    updatedAt: createdAt,
  }

  await writeArtifact("runs/current.json", run, projectRoot)
  await writeArtifact("corpus/evidence-packs/evidence-1.json", evidencePack, projectRoot)
  await writeArtifact("preferences/boundaries.json", profile, projectRoot)
  writeFileSync(join(projectRoot, ".novel", "preferences.md"), "# Preferences\n\nPrefer lyrical suspense.\n", "utf8")
  mkdirSync(join(projectRoot, ".novel", "corpus", "sources"), { recursive: true })
  writeFileSync(join(projectRoot, ".novel", "corpus", "sources", "source-1.txt"), sentinel, "utf8")
}
