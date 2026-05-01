import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NovelError, NovelErrorCode } from "../../errors"
import { SCHEMA_VERSION, computeArtifactHash, type RunState } from "../../schemas"
import { initNovelProject, readArtifact, writeArtifact } from "../../storage"
import { createAllTools } from ".."

let projectRoot: string

function ctx() {
  return {
    sessionID: "session-1",
    messageID: "message-1",
    agent: "creative-director",
    directory: projectRoot,
    worktree: projectRoot,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: () => undefined,
  } as never
}

function parseToolOutput(result: unknown): Record<string, unknown> {
  if (typeof result === "string") {
    return JSON.parse(result) as Record<string, unknown>
  }
  return JSON.parse((result as { output: string }).output) as Record<string, unknown>
}

function runState(stage: RunState["stage"], artifactIds: string[] = []): RunState {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: "run-1",
    projectId: "project-1",
    stage,
    artifactIds,
    updatedAt: new Date().toISOString(),
  }
}

describe("draft flow and explicit canon acceptance", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-draft-flow-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("writing draft doesn't mutate canon facts", async () => {
    const project = await initNovelProject(projectRoot)
    await writeArtifact("runs/current.json", { ...runState("prose_draft"), projectId: project.projectId }, projectRoot)
    const tools = createAllTools()

    const draft = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "draft-1",
      runId: "run-1",
      createdAt: new Date().toISOString(),
      stage: "prose_draft",
      status: "draft",
      sourceArtifactIds: [],
      proseContent: "The silver observatory stood silent.",
      factAssumptions: [
        { subject: "observatory", predicate: "is", object: "silent" }
      ],
      eventReference: "event-1",
      contentHash: computeArtifactHash("The silver observatory stood silent."),
      version: 1,
    }

    await tools.novel_write_artifact.execute({
      artifact: { kind: "draft", artifactId: "draft-1" },
      payload: draft,
    }, ctx())

    const factsPath = join(projectRoot, ".novel", "canon", "facts.json")
    expect(JSON.parse(readFileSync(factsPath, "utf8"))).toEqual([])
  })

  test("explicit accept promotes facts from draft", async () => {
    const project = await initNovelProject(projectRoot)
    const prose = "The silver observatory stood silent."
    const hash = computeArtifactHash(prose)
    const draft = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "draft-1",
      runId: "run-1",
      createdAt: new Date().toISOString(),
      stage: "prose_draft",
      status: "draft",
      sourceArtifactIds: [],
      proseContent: prose,
      factAssumptions: [
        { subject: "observatory", predicate: "is", object: "silent" }
      ],
      eventReference: "event-1",
      contentHash: hash,
      version: 1,
    }
    const review = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "review-1",
      runId: "run-1",
      createdAt: new Date().toISOString(),
      stage: "prose_review",
      sourceArtifactIds: ["draft-1"],
      status: "pass",
      gate: "continuity",
      severity: "info",
      blockingIssues: [],
      nonBlockingSuggestions: [],
      affectedArtifactIds: ["draft-1"],
      artifactHash: hash,
      reason: "Looks good",
      suggestedFix: "None",
      requiresUserDecision: false,
      reviewedArtifactId: "draft-1",
      reviewedArtifactHash: hash,
      reviewedArtifactVersion: 1,
      decision: "approved",
      deltas: [],
      reviewerId: "reviewer-1",
    }
    
    await writeArtifact("runs/current.json", { ...runState("canon_acceptance_pending", ["draft-1", "review-1"]), projectId: project.projectId }, projectRoot)
    await writeArtifact("drafts/draft-1.json", draft, projectRoot)
    await writeArtifact("reviews/review-1.json", review, projectRoot)
    
    const tools = createAllTools()

    const output = parseToolOutput(await tools.novel_accept_canon.execute({
      explicitAcceptance: { 
        acceptedBy: "director-1", 
        acceptedAt: new Date().toISOString(), 
        acceptedArtifactHash: hash, 
        action: "accept_canon" 
      }
    }, ctx()))

    expect(output.accepted).toBe(true)
    expect(output.path).toBe("canon/facts.json")
    const canon = JSON.parse(readFileSync(join(projectRoot, ".novel", "canon", "facts.json"), "utf8")) as any[]
    expect(canon).toHaveLength(1)
    expect(canon[0]).toMatchObject({
      subject: "observatory",
      predicate: "is",
      object: "silent"
    })
    expect(canon[0].factId).toBeDefined()
    expect(canon[0].evidenceArtifactIds).toEqual(["draft-1"])
  })


  test("explicit accept merges facts into existing canon facts", async () => {
    const project = await initNovelProject(projectRoot)
    const prose = "The silver observatory stood silent."
    const hash = computeArtifactHash(prose)
    const existingFact = { factId: "fact-existing", subject: "moon", predicate: "is", object: "blue", evidenceArtifactIds: ["manual"] }
    const draft = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "draft-1",
      runId: "run-1",
      createdAt: new Date().toISOString(),
      stage: "prose_draft",
      status: "draft",
      sourceArtifactIds: [],
      proseContent: prose,
      factAssumptions: [{ subject: "observatory", predicate: "is", object: "silent" }],
      eventReference: "event-1",
      contentHash: hash,
      version: 1,
    }
    const review = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "review-1",
      runId: "run-1",
      createdAt: new Date().toISOString(),
      stage: "prose_review",
      sourceArtifactIds: ["draft-1"],
      status: "pass",
      gate: "continuity",
      severity: "info",
      blockingIssues: [],
      nonBlockingSuggestions: [],
      affectedArtifactIds: ["draft-1"],
      artifactHash: hash,
      reason: "Looks good",
      suggestedFix: "None",
      requiresUserDecision: false,
      reviewedArtifactId: "draft-1",
      reviewedArtifactHash: hash,
      reviewedArtifactVersion: 1,
      decision: "approved",
      deltas: [],
      reviewerId: "reviewer-1",
    }
    await writeArtifact("runs/current.json", { ...runState("canon_acceptance_pending", ["draft-1", "review-1"]), projectId: project.projectId }, projectRoot)
    await writeArtifact("drafts/draft-1.json", draft, projectRoot)
    await writeArtifact("reviews/review-1.json", review, projectRoot)
    const factsPath = join(projectRoot, ".novel", "canon", "facts.json")
    await Bun.write(factsPath, `${JSON.stringify([existingFact], null, 2)}\n`)

    await createAllTools().novel_accept_canon.execute({
      explicitAcceptance: { acceptedBy: "director-1", acceptedAt: new Date().toISOString(), acceptedArtifactHash: hash, action: "accept_canon" }
    }, ctx())

    const facts = JSON.parse(readFileSync(factsPath, "utf8")) as any[]
    expect(facts).toHaveLength(2)
    expect(facts[0]).toEqual(existingFact)
    expect(facts[1]).toMatchObject({ subject: "observatory", predicate: "is", object: "silent" })
  })

  test("failing review blocks acceptance", async () => {
    const project = await initNovelProject(projectRoot)
    const hash = computeArtifactHash("prose")
    const review = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "review-1",
      runId: "run-1",
      createdAt: new Date().toISOString(),
      stage: "prose_review",
      sourceArtifactIds: ["draft-1"],
      status: "fail",
      gate: "continuity",
      severity: "blocking",
      blockingIssues: [{ issue: "Bad continuity", suggestedFix: "Fix it" }],
      nonBlockingSuggestions: [],
      affectedArtifactIds: ["draft-1"],
      artifactHash: hash,
      reason: "Bad",
      suggestedFix: "Fix",
      requiresUserDecision: false,
      reviewedArtifactId: "draft-1",
      reviewedArtifactHash: hash,
      reviewedArtifactVersion: 1,
      decision: "revision_required",
      deltas: [],
      reviewerId: "reviewer-1",
    }
    
    await writeArtifact("runs/current.json", { ...runState("canon_acceptance_pending", ["review-1"]), projectId: project.projectId }, projectRoot)
    await writeArtifact("reviews/review-1.json", review, projectRoot)
    const tools = createAllTools()

    try {
      await tools.novel_accept_canon.execute({
        explicitAcceptance: { 
          acceptedBy: "director-1", 
          acceptedAt: new Date().toISOString(), 
          acceptedArtifactHash: hash, 
          action: "accept_canon" 
        }
      }, ctx())
      throw new Error("Should have failed")
    } catch (e: any) {
      expect(e.code).toBe(NovelErrorCode.STAGE_TRANSITION_BLOCKED)
    }
  })

  test("rejecting draft archives run without canon mutation", async () => {
    const project = await initNovelProject(projectRoot)
    await writeArtifact("runs/current.json", { ...runState("canon_acceptance_pending"), projectId: project.projectId }, projectRoot)
    const tools = createAllTools()

    const output = parseToolOutput(await tools.novel_archive_run.execute({}, ctx()))

    expect(output.archived).toBe(true)
    expect((output.currentRun as any).stage).toBe("archived_without_acceptance")
    
    expect(JSON.parse(readFileSync(join(projectRoot, ".novel", "canon", "facts.json"), "utf8"))).toEqual([])
  })
})
