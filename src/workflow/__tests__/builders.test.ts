import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { computeArtifactHash, SCHEMA_VERSION, type ReviewGateName, type ReviewResult, type RunState } from "../../schemas"
import type { DetailedOutlineArtifact, DraftArtifact, RoughOutlineArtifact } from "../../schemas/artifacts"
import { initNovelProject, readArtifact } from "../../storage"
import type { CompileOutlineOptions, DraftFromEventOptions } from "../builders"
import {
  compileDetailedOutlineFromMarkdown,
  compileRoughOutlineFromMarkdown,
  createDraftFromApprovedEvent,
  recordApprovedReviewSet,
} from "../builders"
import {
  compileAndStoreDetailedOutline,
  compileAndStoreRoughOutline,
} from "../services"

const createdAt = "2026-05-01T00:00:00.000Z"

const VALID_ROUGH_MARKDOWN = [
  "## Premise/Logline",
  "A courier returns a lost vow.",
  "",
  "## Arc Intent",
  "The story follows a courier who must deliver a vow before time runs out.",
  "",
  "## Acts",
  "### Act 1: The Vow",
  "#### Goals",
  "Establish the world and the vow.",
  "#### Stakes",
  "The vow must be delivered within three days.",
  "#### Key Events",
  "- Courier receives the vow.\n- Journey begins.",
  "### Act 2: The Public Trial",
  "#### Goals",
  "Expose the academy's fraud in public.",
  "#### Stakes",
  "Failure means exile and the loss of the vow.",
  "#### Key Events",
  "- Courier enters the tribunal.\n- Fraud is revealed.",
  "",
  "## Core Conflicts",
  "Man vs nature, man vs self.",
  "",
  "## World Assumptions",
  "Magic exists but is fading from the world.",
  "",
  "## Protagonist Emotional Trajectory",
  "From reluctant to determined.",
].join("\n")

const VALID_DETAILED_MARKDOWN = [
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

const INCOMPLETE_MARKDOWN = "## Premise/Logline\nOnly a premise."

let projectRoot: string

function runState(stage: RunState["stage"]): RunState {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: "run-test-1",
    projectId: "project-test-1",
    stage,
    artifactIds: [],
    updatedAt: createdAt,
  }
}

function approvedReview(hash: string, gate = "logic-world-motivation"): ReviewResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId: `review-${gate}`,
    runId: "run-test-1",
    createdAt,
    stage: "rough_outline_review",
    sourceArtifactIds: [],
    status: "pass",
    gate: gate as ReviewGateName,
    severity: "info",
    blockingIssues: [],
    nonBlockingSuggestions: [],
    affectedArtifactIds: ["artifact-1"],
    artifactHash: hash,
    reason: "Review passes.",
    suggestedFix: "No fix needed.",
    requiresUserDecision: false,
    reviewedArtifactId: "artifact-1",
    reviewedArtifactHash: hash,
    reviewedArtifactVersion: 1,
    decision: "approved",
    deltas: [],
    reviewerId: "reviewer-1",
  }
}

describe("workflow builders", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-workflow-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("compileRoughOutlineFromMarkdown produces valid RoughOutlineArtifact", () => {
    const run = runState("rough_outline_draft")
    const options: CompileOutlineOptions = { sourcePath: "authored/rough-outline.md" }

    const artifact = compileRoughOutlineFromMarkdown(VALID_ROUGH_MARKDOWN, run, options)

    expect(artifact.schemaVersion).toBe(SCHEMA_VERSION)
    expect(artifact.runId).toBe("run-test-1")
    expect(artifact.stage).toBe("rough_outline_draft")
    expect(artifact.logline).toBe("A courier returns a lost vow.")
    expect(artifact.acts).toHaveLength(2)
    expect(artifact.acts[0].title).toBe("Act 1: The Vow")
    expect(artifact.contentHash).toHaveLength(64)
    expect(artifact.version).toBe(1)
    expect(artifact.status).toBe("draft")
  })

  test("compileDetailedOutlineFromMarkdown produces valid DetailedOutlineArtifact", () => {
    const run = runState("detailed_outline_draft")
    const options: CompileOutlineOptions = { sourcePath: "authored/detailed-outline.md" }

    const artifact = compileDetailedOutlineFromMarkdown(VALID_DETAILED_MARKDOWN, run, options)

    expect(artifact.schemaVersion).toBe(SCHEMA_VERSION)
    expect(artifact.runId).toBe("run-test-1")
    expect(artifact.stage).toBe("detailed_outline_draft")
    expect(artifact.chapters).toHaveLength(1)
    expect(artifact.chapters[0].chapterNumber).toBe(1)
    expect(artifact.chapters[0].title).toBe("The Vow Received")
    expect(artifact.chapters[0].synopsis).toBe("A courier receives a mysterious vow from a cloaked figure.")
    expect(artifact.chapters[0].keyEvents).toContain("Courier meets the sender.")
    expect(artifact.contentHash).toHaveLength(64)
    expect(artifact.version).toBe(1)
    expect(artifact.status).toBe("draft")
  })

  test("Malformed rough outline markdown throws parsing error", () => {
    const run = runState("rough_outline_draft")
    const options: CompileOutlineOptions = { sourcePath: "authored/rough-outline.md" }

    expect(() => compileRoughOutlineFromMarkdown(INCOMPLETE_MARKDOWN, run, options)).toThrow(
      "Rough outline markdown parsing failed",
    )
  })

  test("createDraftFromApprovedEvent produces valid DraftArtifact", () => {
    const run = runState("prose_draft")
    const prose = "The courier stepped into the rain, the vow pressed against his chest."
    const eventRef = "chapter-1-opener"
    const options: DraftFromEventOptions = {
      sourcePath: "events/chapter-1.md",
      eventReference: eventRef,
      factAssumptions: [{ subject: "courier", predicate: "delivers", object: "vow" }],
    }

    const artifact = createDraftFromApprovedEvent(prose, run, eventRef, options)

    expect(artifact.schemaVersion).toBe(SCHEMA_VERSION)
    expect(artifact.stage).toBe("prose_draft")
    expect(artifact.proseContent).toBe(prose)
    expect(artifact.eventReference).toBe(eventRef)
    expect(artifact.factAssumptions).toHaveLength(1)
    expect(artifact.factAssumptions[0].subject).toBe("courier")
    expect(artifact.contentHash).toHaveLength(64)
    expect(artifact.version).toBe(1)
    expect(artifact.status).toBe("draft")
  })

  test("recordApprovedReviewSet validates all reviews pass", () => {
    const hash = computeArtifactHash("test content")
    const reviews = [
      approvedReview(hash, "logic-world-motivation"),
      approvedReview(hash, "continuity"),
      approvedReview(hash, "preference-boundary"),
    ]

    const gateSet = recordApprovedReviewSet(reviews, hash)

    expect(gateSet.reviews).toHaveLength(3)
    expect(gateSet.currentArtifactHash).toBe(hash)
    for (const review of gateSet.reviews) {
      expect(review.status).toBe("pass")
    }
  })

  test("recordApprovedReviewSet rejects stale review with wrong artifactHash", () => {
    const hash = computeArtifactHash("test content")
    const staleHash = computeArtifactHash("different content")
    const reviews = [approvedReview(hash, "logic-world-motivation")]

    expect(() => recordApprovedReviewSet(reviews, staleHash)).toThrow(
      "stale or for a different artifact",
    )
  })

  test("Integration: compileAndStoreRoughOutline writes to temp dir", async () => {
    const project = await initNovelProject(projectRoot)
    const run: RunState = { ...runState("rough_outline_draft"), projectId: project.projectId }
    const options: CompileOutlineOptions = { sourcePath: "authored/rough-outline.md" }

    const artifact = await compileAndStoreRoughOutline(VALID_ROUGH_MARKDOWN, run, options, projectRoot)

    expect(artifact.logline).toBe("A courier returns a lost vow.")
    expect(artifact.acts).toHaveLength(2)
    expect(artifact.arcIntent).toBe("The story follows a courier who must deliver a vow before time runs out.")
    expect(artifact.acts[0].goals).toBe("Establish the world and the vow.")

    const stored = (await readArtifact(
      `outlines/rough/${artifact.artifactId}.json`,
      projectRoot,
    )) as RoughOutlineArtifact
    expect(stored.artifactId).toBe(artifact.artifactId)
    expect(stored.logline).toBe("A courier returns a lost vow.")
    expect(stored.acts).toHaveLength(2)
  })

  test("Integration: compileAndStoreDetailedOutline writes to temp dir", async () => {
    const project = await initNovelProject(projectRoot)
    const run: RunState = { ...runState("detailed_outline_draft"), projectId: project.projectId }
    const options: CompileOutlineOptions = { sourcePath: "authored/detailed-outline.md" }

    const artifact = await compileAndStoreDetailedOutline(VALID_DETAILED_MARKDOWN, run, options, projectRoot)

    expect(artifact.chapters).toHaveLength(1)
    expect(artifact.chapters[0].title).toBe("The Vow Received")
    expect(artifact.chapters[0].goal).toBe("Introduce the courier and the vow.")

    const stored = (await readArtifact(
      `outlines/detailed/${artifact.artifactId}.json`,
      projectRoot,
    )) as DetailedOutlineArtifact
    expect(stored.artifactId).toBe(artifact.artifactId)
    expect(stored.chapters).toHaveLength(1)
    expect(stored.chapters[0].goal).toBe("Introduce the courier and the vow.")
  })
})
