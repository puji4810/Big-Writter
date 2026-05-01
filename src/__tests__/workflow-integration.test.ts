import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NovelError, NovelErrorCode } from "../errors"
import {
  RequiredOutlineReviewGates,
  SCHEMA_VERSION,
  computeArtifactHash,
  type ReviewGateName,
  type ReviewResult,
  type ReviewStage,
  type RunState,
} from "../schemas"
import { initNovelProject, writeArtifact } from "../storage"
import { recordReviewArtifact } from "../tools/novel-record-review"
import { readCurrentRun, writeCurrentRun } from "../tools/common"
import { compileAndStoreDetailedOutline, compileAndStoreRoughOutline, createAndStoreDraft } from "../workflow/services"
import { isProseAllowed } from "../workflow/review-orchestrator"

const createdAt = "2026-05-01T00:00:00.000Z"

const ROUGH_OUTLINE_MARKDOWN = [
  "## Premise/Logline",
  "A contract courier risks her future to expose academy fraud.",
  "",
  "## Arc Intent",
  "Escalate a courier's private errand into a public trial that forces her to choose between safety and truth.",
  "",
  "## Acts",
  "### Act 1: The Summons",
  "#### Goals",
  "Establish the courier, the forged contracts, and the public risk of speaking up.",
  "#### Stakes",
  "If she stays silent, debt collectors seize her family's medicine fund.",
  "#### Key Events",
  "- The courier receives proof of tampered contracts.\n- She is warned to keep the evidence hidden.",
  "### Act 2: The Hearing",
  "#### Goals",
  "Force the academy to answer for the forged contracts in front of the magistrate.",
  "#### Stakes",
  "If the hearing fails, the academy buries the evidence and brands her a liar.",
  "#### Key Events",
  "- The magistrate opens the hearing.\n- The courier reads each forged seal aloud.",
  "",
  "## Core Conflicts",
  "Duty versus survival, institutional corruption versus public truth.",
  "",
  "## World Assumptions",
  "Contracts are enforced through oath tablets and academy seals.",
  "",
  "## Protagonist Emotional Trajectory",
  "From cautious and indebted to openly defiant.",
].join("\n")

const DETAILED_OUTLINE_MARKDOWN = [
  "## Chapter 1: Public Evidence",
  "### Chapter Goal",
  "Move the courier from secret evidence gathering into a public accusation.",
  "### POV/Focus",
  "Third person limited through the courier's POV.",
  "### Setup/Payoff",
  "The hidden ledger becomes admissible evidence at the hearing.",
  "### Conflict Escalation",
  "A magistrate's clerk offers a bribe moments before the hearing starts.",
  "### World/Canon Dependencies",
  "Oath tablets verify seals, and false seals trigger public disgrace.",
  "### Character Motivation Beats",
  "The courier needs the medicine fund but cannot accept silence any longer.",
  "### Synopsis",
  "A courier rejects a bribe and presents the forged academy contracts during a crowded public hearing.",
  "### Key Events",
  "- The courier enters the hearing hall.\n- She refuses the bribe.\n- She reads the forged seal numbers aloud.",
  "### Ending Hook",
  "A hidden patron marks her for retaliation once the gallery erupts.",
  "### Continuity Hooks",
  "The patron's crest matches the sender's ring from the opening act.",
].join("\n")

const REVISED_DETAILED_OUTLINE_MARKDOWN = [
  "## Chapter 1: Public Evidence Revised",
  "### Chapter Goal",
  "Reframe the hearing around a second witness who confirms the courier's testimony.",
  "### POV/Focus",
  "Third person limited through the courier's POV.",
  "### Setup/Payoff",
  "The witness introduces a missing ledger page that changes the accusation.",
  "### Conflict Escalation",
  "The academy calls the courier a thief before the witness interrupts.",
  "### World/Canon Dependencies",
  "Oath tablets verify seals, and public witnesses can compel a recount.",
  "### Character Motivation Beats",
  "The courier realizes she is no longer standing alone.",
  "### Synopsis",
  "A revised hearing introduces a surprise witness and new evidence, changing the chapter's stakes and the outline hash.",
  "### Key Events",
  "- The academy denounces the courier.\n- A witness reveals the missing ledger page.\n- The magistrate orders a recount.",
  "### Ending Hook",
  "The hidden patron loses control of the room and changes targets.",
  "### Continuity Hooks",
  "The witness once served the patron's household under an alias.",
].join("\n")

let projectRoot: string

function makeRun(projectId: string, stage: RunState["stage"]): RunState {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: "run-1",
    projectId,
    stage,
    artifactIds: [],
    updatedAt: createdAt,
  }
}

function approvedReview(
  stage: ReviewStage,
  artifactId: string,
  reviewedArtifactId: string,
  hash: string,
  gate: ReviewGateName,
  reviewedArtifactVersion: number,
): ReviewResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    artifactId,
    runId: "run-1",
    createdAt,
    stage,
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
    reviewedArtifactVersion,
    decision: "approved",
    deltas: [],
    reviewerId: `${gate}-reviewer`,
  }
}

async function replacePendingOutlineReviewsWithApproved(
  run: RunState,
  reviewedArtifactId: string,
  hash: string,
  version: number,
): Promise<RunState> {
  const pendingReviewIds = run.artifactIds.filter((artifactId) => artifactId !== reviewedArtifactId)
  let currentRun: RunState = {
    ...run,
    artifactIds: run.artifactIds.filter((artifactId) => !pendingReviewIds.includes(artifactId)),
  }
  await writeCurrentRun(currentRun, projectRoot)

  for (const gate of RequiredOutlineReviewGates) {
    const review = approvedReview(
      "detailed_outline_review",
      `approved-${version}-${gate}`,
      reviewedArtifactId,
      hash,
      gate,
      version,
    )
    currentRun = await recordReviewArtifact(review, projectRoot, currentRun)
  }

  return currentRun
}

describe("workflow integration", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-workflow-integration-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  test("service flow compiles outlines, auto-triggers reviews, blocks prose until approval, then creates prose draft", async () => {
    const project = await initNovelProject(projectRoot)
    await writeCurrentRun(makeRun(project.projectId, "rough_outline_draft"), projectRoot)

    const initialRun = await readCurrentRun(projectRoot)
    expect(initialRun?.stage).toBe("rough_outline_draft")

    const roughArtifact = await compileAndStoreRoughOutline(
      ROUGH_OUTLINE_MARKDOWN,
      initialRun!,
      { sourcePath: "authored/rough-outline.md", templateVersion: "1.0.0" },
      projectRoot,
    )
    const roughRun = await readCurrentRun(projectRoot)

    expect(roughRun?.stage).toBe("rough_outline_review")
    expect(roughRun?.activeRoughOutline?.artifactId).toBe(roughArtifact.artifactId)
    expect(roughRun?.artifactIds).toHaveLength(4)

    const pendingRoughReviews = roughRun!.artifactIds.filter((artifactId) => artifactId !== roughArtifact.artifactId)
    expect(pendingRoughReviews).toHaveLength(3)

    await writeCurrentRun({ ...roughRun!, stage: "detailed_outline_draft" }, projectRoot)
    const detailedDraftRun = await readCurrentRun(projectRoot)

    const detailedArtifact = await compileAndStoreDetailedOutline(
      DETAILED_OUTLINE_MARKDOWN,
      detailedDraftRun!,
      { sourcePath: "authored/detailed-outline.md", templateVersion: "1.0.0", sourceArtifactIds: [roughArtifact.artifactId] },
      projectRoot,
    )
    const detailedReviewRun = await readCurrentRun(projectRoot)

    expect(detailedReviewRun?.stage).toBe("detailed_outline_review")
    expect(detailedReviewRun?.activeDetailedOutline?.artifactId).toBe(detailedArtifact.artifactId)
    expect(detailedReviewRun?.artifactIds).toHaveLength(8)
    expect(await isProseAllowed(detailedReviewRun!, detailedArtifact.contentHash, projectRoot)).toBe(false)

    try {
      await createAndStoreDraft(
        "Lin Zhou set the oath tablet on the hearing table before the bribe pouch touched her sleeve.",
        detailedReviewRun!,
        "event-1",
        { sourcePath: "events/chapter-1.md", eventReference: "event-1" },
        projectRoot,
      )
      throw new Error("Expected prose creation to be blocked before outline approval")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.STAGE_TRANSITION_BLOCKED)
      }
    }

    const approvedRun = await replacePendingOutlineReviewsWithApproved(
      detailedReviewRun!,
      detailedArtifact.artifactId,
      detailedArtifact.contentHash,
      detailedArtifact.version,
    )
    await writeCurrentRun({ ...approvedRun, stage: "event_selection" }, projectRoot)

    const proseReadyRun = await readCurrentRun(projectRoot)
    expect(await isProseAllowed(proseReadyRun!, detailedArtifact.contentHash, projectRoot)).toBe(true)

    const draft = await createAndStoreDraft(
      "Lin Zhou broke the wax seal, read each number into the stunned hall, and let the silence indict the academy.",
      proseReadyRun!,
      "event-1",
      {
        sourcePath: "events/chapter-1.md",
        eventReference: "event-1",
        factAssumptions: [{ subject: "Lin Zhou", predicate: "reveals", object: "forged contracts" }],
      },
      projectRoot,
    )
    const finalRun = await readCurrentRun(projectRoot)

    expect(draft.eventReference).toBe("event-1")
    expect(draft.contentHash).toBe(computeArtifactHash(draft.proseContent))
    expect(finalRun?.activeProseSelection?.artifactId).toBe(draft.artifactId)
    expect(finalRun?.activeProseSelection?.eventReference).toBe("event-1")
  })

  test("stale detailed outline reviews stop prose after a recompile changes the active hash", async () => {
    const project = await initNovelProject(projectRoot)
    const approvedRunState = makeRun(project.projectId, "detailed_outline_review")
    await writeCurrentRun(approvedRunState, projectRoot)

    const firstArtifact = await compileAndStoreDetailedOutline(
      DETAILED_OUTLINE_MARKDOWN,
      approvedRunState,
      { sourcePath: "authored/detailed-outline.md", templateVersion: "1.0.0", version: 1 },
      projectRoot,
    )
    const firstReviewRun = await readCurrentRun(projectRoot)
    const approvedRun = await replacePendingOutlineReviewsWithApproved(
      firstReviewRun!,
      firstArtifact.artifactId,
      firstArtifact.contentHash,
      firstArtifact.version,
    )
    await writeCurrentRun({ ...approvedRun, stage: "event_selection" }, projectRoot)

    const proseAllowedRun = await readCurrentRun(projectRoot)
    expect(await isProseAllowed(proseAllowedRun!, firstArtifact.contentHash, projectRoot)).toBe(true)

    await writeCurrentRun({ ...proseAllowedRun!, stage: "detailed_outline_draft" }, projectRoot)
    const recompilingRun = await readCurrentRun(projectRoot)
    const secondArtifact = await compileAndStoreDetailedOutline(
      REVISED_DETAILED_OUTLINE_MARKDOWN,
      recompilingRun!,
      { sourcePath: "authored/detailed-outline.md", templateVersion: "1.1.0", version: 2, sourceArtifactIds: [firstArtifact.artifactId] },
      projectRoot,
    )
    const secondReviewRun = await readCurrentRun(projectRoot)

    expect(secondArtifact.contentHash).not.toBe(firstArtifact.contentHash)
    expect(secondReviewRun?.activeDetailedOutline?.artifactId).toBe(secondArtifact.artifactId)
    expect(await isProseAllowed(secondReviewRun!, secondArtifact.contentHash, projectRoot)).toBe(false)

    try {
      await createAndStoreDraft(
        "The witness stepped from the gallery before the academy could bury the new ledger page.",
        secondReviewRun!,
        "event-2",
        { sourcePath: "events/chapter-1-revised.md", eventReference: "event-2" },
        projectRoot,
      )
      throw new Error("Expected stale reviews to block prose after recompile")
    } catch (error) {
      expect(error).toBeInstanceOf(NovelError)
      if (error instanceof NovelError) {
        expect(error.code).toBe(NovelErrorCode.STAGE_TRANSITION_BLOCKED)
      }
    }
  })
})
