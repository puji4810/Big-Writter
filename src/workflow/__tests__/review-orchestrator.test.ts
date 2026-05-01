import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RequiredOutlineReviewGates, SCHEMA_VERSION, computeArtifactHash, type ReviewGateName, type ReviewResult, type RunState } from "../../schemas"
import { NovelError, NovelErrorCode } from "../../errors"
import { initNovelProject, readArtifact, writeArtifact } from "../../storage"
import { readCurrentRun } from "../../tools/common"
import { compileAndStoreDetailedOutline, createAndStoreDraft } from "../services"
import { autoTriggerReviews, invalidateStaleReviews, isProseAllowed, validateReviewSet } from "../review-orchestrator"

const createdAt = "2026-05-01T00:00:00.000Z"

const ORIGINAL_DETAILED_MARKDOWN = [
  "## Chapter 1: The Vow Received",
  "### Chapter Goal",
  "Introduce the courier and the vow.",
  "### POV/Focus",
  "Third person limited, courier's POV.",
  "### Setup/Payoff",
  "The vow is introduced but its importance is unclear.",
  "### Conflict Escalation",
  "The courier is warned not to take this job.",
  "### World/Canon Dependencies",
  "Magic is fading from the world.",
  "### Character Motivation Beats",
  "The courier needs money for medicine.",
  "### Synopsis",
  "A courier receives a mysterious vow from a cloaked figure.",
  "### Key Events",
  "- Courier meets the sender.\n- The vow is handed over.",
  "### Ending Hook",
  "Someone watches from the shadows.",
  "### Continuity Hooks",
  "The shadow figure will return.",
].join("\n")

const REVISED_DETAILED_MARKDOWN = [
  "## Chapter 1: Public Evidence",
  "### Chapter Goal",
  "Reframe the chapter around a public hearing.",
  "### POV/Focus",
  "Third person limited, courier's POV.",
  "### Setup/Payoff",
  "The hearing reveals the academy contract fraud.",
  "### Conflict Escalation",
  "The courier rejects a bribe in front of the magistrate.",
  "### World/Canon Dependencies",
  "Contracts are enforced through oath tablets.",
  "### Character Motivation Beats",
  "The courier risks the medicine fund to expose the scheme.",
  "### Synopsis",
  "A courier presents contract evidence during a crowded academy hearing.",
  "### Key Events",
  "- Courier enters the hearing.\n- The magistrate reads the contract seals.",
  "### Ending Hook",
  "A hidden patron marks the courier for revenge.",
  "### Continuity Hooks",
  "The patron's crest matches the sender's ring.",
].join("\n")

let projectRoot: string

function detailedRun(stage: RunState["stage"], hash: string, artifactId = "detailed-1", extraArtifactIds: string[] = []): RunState {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: "run-1",
    projectId: "project-1",
    stage,
    artifactIds: [artifactId, ...extraArtifactIds],
    updatedAt: createdAt,
    activeDetailedOutline: {
      artifactId,
      markdownPath: "authored/detailed-outline.md",
      markdownHash: hash,
      templateVersion: "1.0.0",
      compiledAt: createdAt,
      syncStatus: "clean",
    },
  }
}

function approvedReview(hash: string, gate: ReviewGateName, reviewedArtifactId = "detailed-1"): ReviewResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId: `review-${gate}`,
    runId: "run-1",
    createdAt,
    stage: "detailed_outline_review",
    sourceArtifactIds: [reviewedArtifactId],
    status: "pass",
    gate,
    severity: "info",
    blockingIssues: [],
    nonBlockingSuggestions: [],
    affectedArtifactIds: [reviewedArtifactId],
    artifactHash: hash,
    reason: `${gate} passed.`,
    suggestedFix: "No fix needed.",
    requiresUserDecision: false,
    reviewedArtifactId,
    reviewedArtifactHash: hash,
    reviewedArtifactVersion: 1,
    decision: "approved",
    deltas: [],
    reviewerId: `${gate}-reviewer`,
  }
}

describe("review orchestrator", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-review-orchestrator-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("after detailed outline compile the run moves back to review and auto review dispatch is triggered", async () => {
    const project = await initNovelProject(projectRoot)
    const previousHash = computeArtifactHash(ORIGINAL_DETAILED_MARKDOWN)
    const run = { ...detailedRun("event_selection", previousHash), projectId: project.projectId }
    await writeArtifact("runs/current.json", run, projectRoot)

    const artifact = await compileAndStoreDetailedOutline(
      REVISED_DETAILED_MARKDOWN,
      run,
      { sourcePath: "authored/detailed-outline.md", templateVersion: "1.0.0" },
      projectRoot,
    )
    const updatedRun = await readCurrentRun(projectRoot)

    expect(updatedRun).not.toBeNull()
    expect(updatedRun?.stage).toBe("detailed_outline_review")
    expect(updatedRun?.activeDetailedOutline?.artifactId).toBe(artifact.artifactId)

    const plan = await autoTriggerReviews(updatedRun!, artifact.artifactId, artifact.contentHash, projectRoot)
    expect(plan.requiredGates).toEqual([...RequiredOutlineReviewGates])
    expect(plan.missingReviewGates).toEqual([])
    expect(plan.dispatchedAgents).toEqual([])
    const reviews = updatedRun?.artifactIds.filter((artifactId) => artifactId !== artifact.artifactId && artifactId !== "detailed-1") ?? []
    expect(reviews).toHaveLength(3)
  })

  test("prose is blocked before the active detailed outline has the required approved review set", async () => {
    const project = await initNovelProject(projectRoot)
    const hash = computeArtifactHash(ORIGINAL_DETAILED_MARKDOWN)
    const run = { ...detailedRun("detailed_outline_review", hash), projectId: project.projectId }
    await writeArtifact("runs/current.json", run, projectRoot)

    expect(await isProseAllowed(run, hash, projectRoot)).toBe(false)
  })

  test("prose is allowed after all required detailed outline reviews approve the active hash", async () => {
    const project = await initNovelProject(projectRoot)
    const hash = computeArtifactHash(ORIGINAL_DETAILED_MARKDOWN)
    const reviews = RequiredOutlineReviewGates.map((gate) => approvedReview(hash, gate))
    const run = { ...detailedRun("detailed_outline_review", hash, "detailed-1", reviews.map((review) => review.artifactId)), projectId: project.projectId }
    await writeArtifact("runs/current.json", run, projectRoot)
    for (const review of reviews) {
      await writeArtifact(`reviews/${review.artifactId}.json`, review, projectRoot)
    }

    expect(await isProseAllowed(run, hash, projectRoot)).toBe(true)
    expect(validateReviewSet(reviews, RequiredOutlineReviewGates, hash).valid).toBe(true)
  })

  test("compiling a new detailed outline version invalidates prior approved reviews", async () => {
    const project = await initNovelProject(projectRoot)
    const originalHash = computeArtifactHash(ORIGINAL_DETAILED_MARKDOWN)
    const reviews = RequiredOutlineReviewGates.map((gate) => approvedReview(originalHash, gate))
    const run = { ...detailedRun("event_selection", originalHash, "detailed-1", reviews.map((review) => review.artifactId)), projectId: project.projectId }
    await writeArtifact("runs/current.json", run, projectRoot)
    for (const review of reviews) {
      await writeArtifact(`reviews/${review.artifactId}.json`, review, projectRoot)
    }

    const staleReviews = await invalidateStaleReviews(run, computeArtifactHash(REVISED_DETAILED_MARKDOWN), projectRoot)
    expect(staleReviews).toHaveLength(3)

    const artifact = await compileAndStoreDetailedOutline(
      REVISED_DETAILED_MARKDOWN,
      run,
      { sourcePath: "authored/detailed-outline.md", templateVersion: "1.0.0", version: 2 },
      projectRoot,
    )
    const updatedRun = await readCurrentRun(projectRoot)
    const plan = await autoTriggerReviews(updatedRun!, artifact.artifactId, artifact.contentHash, projectRoot)

    expect(updatedRun?.stage).toBe("detailed_outline_review")
    expect(plan.staleReviews).toEqual([])
    expect(plan.missingReviewGates).toEqual([])
    expect(await isProseAllowed(updatedRun!, artifact.contentHash, projectRoot)).toBe(false)
  })

  test("validateReviewSet marks stale reviews when the active artifact hash changes", () => {
    const oldHash = computeArtifactHash(ORIGINAL_DETAILED_MARKDOWN)
    const newHash = computeArtifactHash(REVISED_DETAILED_MARKDOWN)
    const reviews = RequiredOutlineReviewGates.map((gate) => approvedReview(oldHash, gate))

    const validation = validateReviewSet(reviews, RequiredOutlineReviewGates, newHash)

    expect(validation.valid).toBe(false)
    expect(validation.staleReviews).toHaveLength(3)
    expect(validation.missingGates).toEqual([...RequiredOutlineReviewGates])
  })

  test("compile stores the updated active detailed outline pointer in the run state", async () => {
    const project = await initNovelProject(projectRoot)
    const originalHash = computeArtifactHash(ORIGINAL_DETAILED_MARKDOWN)
    const run = { ...detailedRun("detailed_outline_draft", originalHash), projectId: project.projectId }
    await writeArtifact("runs/current.json", run, projectRoot)

    const artifact = await compileAndStoreDetailedOutline(
      REVISED_DETAILED_MARKDOWN,
      run,
      { sourcePath: "authored/detailed-outline.md", templateVersion: "2.0.0" },
      projectRoot,
    )
    const storedRun = (await readArtifact("runs/current.json", projectRoot)) as RunState

    expect(storedRun.activeDetailedOutline?.artifactId).toBe(artifact.artifactId)
    expect(storedRun.activeDetailedOutline?.markdownHash).toBe(computeArtifactHash(REVISED_DETAILED_MARKDOWN))
    expect(storedRun.activeDetailedOutline?.templateVersion).toBe("2.0.0")
    expect(storedRun.artifactIds).toHaveLength(5)
  })

  test("draft creation hard-blocks prose before the active detailed outline is approved", async () => {
    const project = await initNovelProject(projectRoot)
    const hash = computeArtifactHash(ORIGINAL_DETAILED_MARKDOWN)
    const outlineArtifact = {
      schemaVersion: SCHEMA_VERSION,
      artifactId: "detailed-1",
      runId: "run-1",
      createdAt,
      stage: "detailed_outline_draft",
      sourceArtifactIds: [],
      status: "ready_for_review",
      chapters: [{ chapterNumber: 1, title: "The Vow Received", synopsis: "A courier receives a vow.", keyEvents: ["event-1"] }],
      contentHash: hash,
      version: 1,
    }
    const run = { ...detailedRun("detailed_outline_review", hash), projectId: project.projectId }
    await writeArtifact("runs/current.json", run, projectRoot)
    await writeArtifact("outlines/detailed/detailed-1.json", outlineArtifact, projectRoot)

    try {
      await createAndStoreDraft(
        "The courier places the oath tablet on the hearing table.",
        run,
        "event-1",
        { sourcePath: "events/chapter-1.md", eventReference: "event-1" },
        projectRoot,
      )
      throw new Error("Expected prose drafting to be blocked")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.STAGE_TRANSITION_BLOCKED)
        expect(error.message).toContain("Detailed outline approval")
      }
    }
  })
})
