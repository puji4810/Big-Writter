// Manual QA script for novel-cluster plugin
// Run with: bun run qa-manual.ts
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { resolve, join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID } from "node:crypto"
import { createAllTools, createAllAgents, initNovelProject, readArtifact, writeArtifact, resolveNovelPath, NovelError } from "./src/lib"

// ── AbortController stub ──────────────────────────────────
const ac = new AbortController()

function makeCtx(dir: string): any {
  return {
    sessionID: "qa-manual",
    messageID: "msg-001",
    agent: "qa-agent",
    directory: dir,
    worktree: dir,
    abort: ac.signal,
    metadata(_input: any) {},
    ask(_input: any) {},
  }
}

// ── Test Infrastructure ───────────────────────────────────
let passed = 0
let failed = 0

function assert(condition: boolean, label: string, detail?: any) {
  if (condition) {
    passed++
    console.log(`  ✓ PASS: ${label}`)
  } else {
    failed++
    console.error(`  ✗ FAIL: ${label}`, detail !== undefined ? detail : "")
  }
}

async function assertThrows(fn: () => any, expectedCode?: string, label?: string) {
  try {
    const result = fn()
    if (result instanceof Promise) {
      await result
    }
    failed++
    console.error(`  ✗ FAIL: ${label || "expected error not thrown"}: no error thrown`)
  } catch (e) {
    if (e instanceof NovelError && expectedCode) {
      const codeMatch = e.code === expectedCode
      if (codeMatch) {
        passed++
        console.log(`  ✓ PASS: ${label || "correct error code"}: ${e.code}`)
      } else {
        failed++
        console.error(`  ✗ FAIL: ${label || "wrong error code"}: got ${e.code}, expected ${expectedCode}`)
      }
    } else if (expectedCode) {
      failed++
      console.error(`  ✗ FAIL: ${label || "wrong error type"}: not a NovelError, got ${String(e)}`)
    } else {
      passed++
      console.log(`  ✓ PASS: ${label || "expected error thrown"}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

// ═══════════════════════════════════════════════════════════
// TEST SUITE 1: Plugin structure
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 1: Plugin structure ──")

const tools = createAllTools()
const toolNames = Object.keys(tools)
console.log(`  Tools count: ${toolNames.length}`)
assert(toolNames.length === 11, `createAllTools returns 11 tools (got ${toolNames.length})`)
assert("novel_project_status" in tools, "tool: novel_project_status exists")
assert("novel_init_project" in tools, "tool: novel_init_project exists")
assert("novel_ingest_corpus" in tools, "tool: novel_ingest_corpus exists")
assert("novel_read_artifact" in tools, "tool: novel_read_artifact exists")
assert("novel_write_artifact" in tools, "tool: novel_write_artifact exists")
assert("novel_advance_stage" in tools, "tool: novel_advance_stage exists")
assert("novel_record_review" in tools, "tool: novel_record_review exists")
assert("novel_select_evidence" in tools, "tool: novel_select_evidence exists")
assert("novel_check_boundaries" in tools, "tool: novel_check_boundaries exists")
assert("novel_accept_canon" in tools, "tool: novel_accept_canon exists")
assert("novel_archive_run" in tools, "tool: novel_archive_run exists")

const agents = createAllAgents()
const agentNames = agents.map((a: any) => a.name)
console.log(`  Agents count: ${agentNames.length}`)
assert(agentNames.length === 10, `createAllAgents returns 10 agents (got ${agentNames.length})`)

const expectedAgents = [
  "creative-director",
  "idea-interviewer",
  "rough-outliner",
  "detailed-outliner",
  "logic-world-motivation-reviewer",
  "prose-style-pacing-reviewer",
  "corpus-analyst",
  "writer",
  "continuity-checker",
  "preference-boundary-checker",
]
for (const name of expectedAgents) {
  assert(agentNames.includes(name), `agent: ${name} exists`)
}

// Also verify agents have required fields
for (const agent of agents) {
  assert(typeof agent.name === "string" && agent.name.length > 0, `agent ${agent.name} has name`)
  assert(typeof agent.description === "string" && agent.description.length > 0, `agent ${agent.name} has description`)
  assert(typeof agent.systemPrompt === "string" && agent.systemPrompt.length > 0, `agent ${agent.name} has systemPrompt`)
  assert(typeof agent.mode === "string", `agent ${agent.name} has mode`)
}

// ═══════════════════════════════════════════════════════════
// TEST SUITE 2: Project init in temp dir
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 2: Project init ──")

const tempDir = mkdtempSync(join(tmpdir(), "novel-qa-"))
console.log(`  Temp dir: ${tempDir}`)
const ctx = makeCtx(tempDir)

// 2a. Status before init
const statusTool = tools.novel_project_status
const beforeInit = JSON.parse((await statusTool.execute({}, ctx)).output as string)
assert(beforeInit.initialized === false, "status before init: initialized=false")
assert(beforeInit.nextAction.includes("novel_init_project"), "status before init: includes nextAction hint")

// 2b. Init
const initTool = tools.novel_init_project
const initResult = JSON.parse((await initTool.execute({}, ctx)).output as string)
assert(initResult.initialized === true, "init: initialized=true")
assert(initResult.project.projectId.length > 0, "init: projectId set")
assert(initResult.project.title === "Untitled Novel", "init: default title")
assert(initResult.currentRun.stage === "uninitialized", "init: current run at uninitialized")
assert(existsSync(join(tempDir, ".novel", "project.json")), ".novel/project.json exists on disk")
assert(existsSync(join(tempDir, ".novel", "canon")), ".novel/canon directory exists")
assert(existsSync(join(tempDir, ".novel", "drafts")), ".novel/drafts directory exists")
assert(existsSync(join(tempDir, ".novel", "preferences.md")), ".novel/preferences.md file exists")

// 2c. Status after init
const afterInit = JSON.parse((await statusTool.execute({}, ctx)).output as string)
assert(afterInit.initialized === true, "status after init: initialized=true")
assert(afterInit.currentStage === "uninitialized", "status after init: currentStage=uninitialized")

// 2d. Re-init (idempotent)
const reinitResult = JSON.parse((await initTool.execute({}, ctx)).output as string)
assert(reinitResult.initialized === true, "re-init: still initialized=true")
assert(reinitResult.project.projectId === initResult.project.projectId, "re-init: same projectId")

// ═══════════════════════════════════════════════════════════
// TEST SUITE 3: Write and read artifacts
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 3: Write and read artifacts ──")

const readTool = tools.novel_read_artifact
const writeTool = tools.novel_write_artifact

// 3a. Write a review artifact
const reviewId = randomUUID()
const reviewArtifact = {
  schemaVersion: "1.0.0",
  artifactId: reviewId,
  runId: initResult.currentRun.runId,
  createdAt: new Date().toISOString(),
  stage: "prose_review",
  status: "pass",
  severity: "info",
  blockingIssues: [],
  nonBlockingSuggestions: ["Consider varying chapter length"],
  affectedArtifactIds: [],
  artifactHash: "abc123",
  reason: "Excellent prose, consistent pacing",
  suggestedFix: "N/A",
  requiresUserDecision: false,
  reviewedArtifactId: "draft-001",
  reviewedArtifactHash: "abc123",
  reviewedArtifactVersion: 1,
  gate: "prose-style-pacing",
  decision: "approved",
  deltas: [],
  reviewerId: "qa-reviewer",
  sourceArtifactIds: [],
}

const writeResult = JSON.parse((await writeTool.execute({
  artifact: { kind: "review", artifactId: reviewId },
  payload: reviewArtifact,
}, ctx)).output as string)
assert(writeResult.written === true, "write review: written=true")
assert(writeResult.path.includes("reviews"), "write review: path in reviews dir")
assert(writeResult.artifactId === reviewId, "write review: correct artifactId")
assert(writeResult.currentRunUpdated === true, "write review: currentRun updated with artifactId")

// 3b. Read the review back
const readResult = JSON.parse((await readTool.execute({
  artifact: { kind: "review", artifactId: reviewId },
}, ctx)).output as string)
assert(readResult.artifact.artifactId === reviewId, "read review: correct artifactId")
assert(readResult.artifact.gate === "prose-style-pacing", "read review: correct gate")
assert(readResult.artifact.status === "pass", "read review: correct status")

// 3c. Write a boundary profile (needed for check-boundaries later)
const profileId = randomUUID()
const boundaryProfile = {
  schemaVersion: "1.0.0",
  projectId: initResult.project.projectId,
  profileId,
  preferredTone: ["dark", "suspenseful"],
  avoidedContent: ["cliche", "deus ex machina", "mary sue"],
  hardBoundaries: ["gratuitous", "explicit"],
  updatedAt: new Date().toISOString(),
}

const boundaryWriteResult = JSON.parse((await writeTool.execute({
  artifact: { kind: "boundary_profile" },
  payload: boundaryProfile,
}, ctx)).output as string)
assert(boundaryWriteResult.written === true, "write boundary_profile: written=true")
assert(boundaryWriteResult.artifactId === profileId, "write boundary_profile: correct profileId")

// 3d. Read project.json
const projRead = JSON.parse((await readTool.execute({
  artifact: { kind: "project" },
}, ctx)).output as string)
assert(projRead.artifact.title === "Untitled Novel", "read project: correct title")

// 3e. Write a draft artifact (needed for canon acceptance test later)
const draftId = randomUUID()
const contentHash = "draft-" + randomUUID()
const draftArtifact = {
  schemaVersion: "1.0.0",
  artifactId: draftId,
  runId: initResult.currentRun.runId,
  createdAt: new Date().toISOString(),
  stage: "prose_draft",
  status: "ready_for_review",
  sourceArtifactIds: [],
  proseContent: "The ancient tower loomed over the mist-shrouded valley, its crumbling battlements silhouetted against the blood-red moon.",
  factAssumptions: [
    { subject: "the_tower", predicate: "is_ancient", object: "true" },
    { subject: "the_valley", predicate: "has_mist", object: "true" },
  ],
  eventReference: "event-001",
  contentHash,
  version: 1,
}
const draftWriteResult = JSON.parse((await writeTool.execute({
  artifact: { kind: "draft", artifactId: draftId },
  payload: draftArtifact,
}, ctx)).output as string)
assert(draftWriteResult.written === true, "write draft: written=true")
assert(draftWriteResult.currentRunUpdated === true, "write draft: currentRun updated")

// ═══════════════════════════════════════════════════════════
// TEST SUITE 4: Path traversal rejection
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 4: Path traversal rejection ──")

// 4a. resolveNovelPath rejects absolute paths
assertThrows(
  () => resolveNovelPath("/etc/passwd", tempDir),
  "ERR_PATH_OUTSIDE_NOVEL_ROOT",
  "resolveNovelPath rejects absolute path"
)

// 4b. resolveNovelPath rejects traversal with ..
assertThrows(
  () => resolveNovelPath("../etc/passwd", tempDir),
  "ERR_PATH_OUTSIDE_NOVEL_ROOT",
  "resolveNovelPath rejects ../ traversal"
)

// 4c. resolveNovelPath rejects .novel prefix traversal
assertThrows(
  () => resolveNovelPath(".novel/../../etc/passwd", tempDir),
  "ERR_PATH_OUTSIDE_NOVEL_ROOT",
  "resolveNovelPath rejects .novel/../ traversal"
)

// 4d. resolveNovelPath accepts valid subpaths
const validPath = resolveNovelPath("canon/test.json", tempDir)
assert(validPath.endsWith(join(".novel", "canon", "test.json")), "resolveNovelPath accepts valid subpath")

// ═══════════════════════════════════════════════════════════
// TEST SUITE 5: Corrupt JSON handling
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 5: Corrupt JSON handling ──")

// 5a. Write corrupt JSON to a file and try to read it
const corruptPath = join(tempDir, ".novel", "reviews", "corrupt-test.json")
mkdirSync(join(tempDir, ".novel", "reviews"), { recursive: true })
writeFileSync(corruptPath, "this is not json at all {{{", "utf8")

assertThrows(
  () => readArtifact("reviews/corrupt-test.json" as any, tempDir),
  "ERR_ARTIFACT_CORRUPT",
  "readArtifact rejects corrupt JSON file"
)

// 5b. Write valid JSON that doesn't match any schema
writeFileSync(corruptPath, JSON.stringify({ foo: "bar", baz: 123 }), "utf8")
assertThrows(
  () => readArtifact("reviews/corrupt-test.json" as any, tempDir),
  "ERR_ARTIFACT_CORRUPT",
  "readArtifact rejects JSON not matching any schema"
)

// 5c. Corrupt project.json
rmSync(join(tempDir, ".novel", "project.json"))
writeFileSync(join(tempDir, ".novel", "project.json"), "garbage", "utf8")
assertThrows(
  () => readArtifact("project.json", tempDir),
  "ERR_ARTIFACT_CORRUPT",
  "readArtifact rejects corrupt project.json"
)

// Restore project.json for subsequent tests
rmSync(join(tempDir, ".novel", "project.json"))
const reinit2 = JSON.parse((await initTool.execute({}, ctx)).output as string)
assert(reinit2.initialized === true, "re-init after corrupt project.json")

// ═══════════════════════════════════════════════════════════
// TEST SUITE 6: Check boundaries tool
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 6: Check boundaries ──")

const boundariesTool = tools.novel_check_boundaries

// 6a. Content with no violations
const cleanResult = JSON.parse((await boundariesTool.execute({
  content: "The hero walked through the dark forest, shadows dancing.",
}, ctx)).output as string)
assert(cleanResult.passed === true, "boundaries: clean content passes")
assert(cleanResult.hardBoundaryViolations.length === 0, "boundaries: no hard boundary violations")

// 6b. Content with hard boundary violation
const violationResult = JSON.parse((await boundariesTool.execute({
  content: "The scene contained gratuitous violence that shocked everyone.",
}, ctx)).output as string)
assert(violationResult.passed === false, "boundaries: content with hard boundary fails")
assert(violationResult.hardBoundaryViolations.includes("gratuitous"), "boundaries: detects 'gratuitous'")

// 6c. Content with avoided content
const avoidedResult = JSON.parse((await boundariesTool.execute({
  content: "The ending was a total deus ex machina with a mary sue protagonist.",
}, ctx)).output as string)
assert(avoidedResult.passed === true, "boundaries: avoided content alone doesn't fail")
assert(avoidedResult.avoidedContentMatches.length > 0, "boundaries: detects avoided content")

// 6d. Test with inline profile override
const overrideResult = JSON.parse((await boundariesTool.execute({
  content: "grimdark content",
  profile: {
    schemaVersion: "1.0.0",
    projectId: initResult.project.projectId,
    profileId: randomUUID(),
    preferredTone: ["dark"],
    avoidedContent: [],
    hardBoundaries: ["grimdark"],
    updatedAt: new Date().toISOString(),
  },
}, ctx)).output as string)
assert(overrideResult.passed === false, "boundaries: override profile detects violation")
assert(overrideResult.hardBoundaryViolations.includes("grimdark"), "boundaries: override detects 'grimdark'")

// ═══════════════════════════════════════════════════════════
// TEST SUITE 7: Stage advancement
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 7: Stage advancement ──")

const advanceTool = tools.novel_advance_stage

// 7a. Simple advance: uninitialized -> interviewing
const advanceResult1 = JSON.parse((await advanceTool.execute({
  to: "interviewing",
}, ctx)).output as string)
assert(advanceResult1.advanced === true, "advance: uninitialized -> interviewing")
assert(advanceResult1.to === "interviewing", "advance: correct to stage")

// 7b. interviewing -> rough_outline_draft (needs gates)
assertThrows(
  async () => { await advanceTool.execute({ to: "rough_outline_draft" }, ctx) },
  "ERR_STAGE_TRANSITION_BLOCKED",
  "advance: interviewing -> rough_outline_draft blocked without gates"
)

const advanceOk = JSON.parse((await advanceTool.execute({
  to: "rough_outline_draft",
  gates: { hasInterviewArtifact: true, hasTargetAudience: true, hasStoryObjective: true },
}, ctx)).output as string)
assert(advanceOk.advanced === true, "advance: interviewing -> rough_outline_draft with gates")

// 7c. cannot skip stages
assertThrows(
  async () => { await advanceTool.execute({ to: "prose_draft" }, ctx) },
  "ERR_STAGE_TRANSITION_BLOCKED",
  "advance: cannot skip stages (rough_outline_draft -> prose_draft)"
)

// ═══════════════════════════════════════════════════════════
// TEST SUITE 8: Archive run
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 8: Archive run ──")

const archiveTool = tools.novel_archive_run
const archiveResult = JSON.parse((await archiveTool.execute({}, ctx)).output as string)
assert(archiveResult.archived === true, "archive: archived=true")
assert(archiveResult.currentRun.stage === "archived_without_acceptance", "archive: stage is archived_without_acceptance")

// ═══════════════════════════════════════════════════════════
// TEST SUITE 9: Error messages are clear and actionable
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 9: Error messages ──")

// 9a. Reading from uninitialized project
const freshTempDir = mkdtempSync(join(tmpdir(), "novel-qa2-"))
const ctx2 = makeCtx(freshTempDir)
try {
  await readTool.execute({ artifact: { kind: "project" } }, ctx2)
  failed++
  console.error("  ✗ FAIL: read from uninit project should throw")
} catch (e) {
  if (e instanceof NovelError && e.code === "ERR_PROJECT_NOT_INITIALIZED") {
    passed++
    console.log(`  ✓ PASS: read from uninitialized project: ${e.code}`)
    assert(e.message.includes(".novel"), "error message includes .novel path")
    assert(e.message.length > 20, "error message is descriptive")
  } else {
    failed++
    console.error(`  ✗ FAIL: wrong error: ${String(e)}`)
  }
}

// 9b. Write to uninitialized project (non-project.json)
try {
  await writeTool.execute({
    artifact: { kind: "review", artifactId: randomUUID() },
    payload: reviewArtifact,
  }, ctx2)
  failed++
  console.error("  ✗ FAIL: write to uninit project should throw")
} catch (e) {
  if (e instanceof NovelError && e.code === "ERR_PROJECT_NOT_INITIALIZED") {
    passed++
    console.log(`  ✓ PASS: write to uninitialized project: ${e.code}`)
  } else {
    failed++
    console.error(`  ✗ FAIL: wrong error: ${String(e)}`)
  }
}

// 9c. Advance stage from uninitialized project
try {
  await advanceTool.execute({ to: "interviewing" }, ctx2)
  failed++
  console.error("  ✗ FAIL: advance from uninit project should throw")
} catch (e) {
  if (e instanceof NovelError && e.code === "ERR_PROJECT_NOT_INITIALIZED") {
    passed++
    console.log(`  ✓ PASS: advance from uninitialized project: ${e.code}`)
  } else {
    failed++
    console.error(`  ✗ FAIL: wrong error: ${String(e)}`)
  }
}

// 9d. Canon acceptance from wrong stage
try {
  await tools.novel_accept_canon.execute({
    explicitAcceptance: { acceptedBy: "qa", acceptedAt: new Date().toISOString(), acceptedArtifactHash: "abc", action: "accept_canon" },
  }, ctx)
  failed++
  console.error("  ✗ FAIL: accept canon from archived stage should throw")
} catch (e) {
  if (e instanceof NovelError && e.code === "ERR_STAGE_TRANSITION_BLOCKED") {
    passed++
    console.log(`  ✓ PASS: accept canon from wrong stage: ${e.code}`)
    assert(e.message.includes("canon_acceptance_pending"), "error message mentions required stage")
  } else {
    failed++
    console.error(`  ✗ FAIL: wrong error: ${String(e)}`)
  }
}

// Cleanup temp dirs
rmSync(tempDir, { recursive: true, force: true })
rmSync(freshTempDir, { recursive: true, force: true })

// ═══════════════════════════════════════════════════════════
// TEST SUITE 10: Ingest corpus
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 10: Ingest corpus ──")

const ingestCtx = makeCtx(mkdtempSync(join(tmpdir(), "novel-qa-ingest-")))
const ingestInit = JSON.parse((await tools.novel_init_project.execute({}, ingestCtx)).output as string)

const corpusDir = join(ingestCtx.directory, "corpus-inputs")
mkdirSync(corpusDir, { recursive: true })

const sampleFile1 = join(corpusDir, "sample1.txt")
writeFileSync(sampleFile1, `Chapter 1: The Awakening

The dark forest stretched endlessly before him. Shadows danced between ancient trees, and the cold wind carried whispers of forgotten secrets.

He had been walking for hours, but the path never seemed to end. The moon hung low on the horizon, its pale light his only guide.`, "utf8")

const sampleFile2 = join(corpusDir, "sample2.md")
writeFileSync(sampleFile2, `# Chapter One

## The Beginning

She arrived at the academy gates just as the sun broke over the eastern towers. Students in flowing robes hurried past her, their faces buried in ancient texts.

"First year?" a voice called out from behind.

She turned to face a tall figure in crimson robes.`, "utf8")

const ingestTool = tools.novel_ingest_corpus

// 10a. Ingest a .txt file
const ingestResult1 = JSON.parse((await ingestTool.execute({
  files: [sampleFile1],
  authorizationNote: "QA test corpus — authorized",
}, ingestCtx)).output as string)
assert(ingestResult1.ingested === 1, "ingest: 1 file ingested")
assert(ingestResult1.skipped === 0, "ingest: 0 skipped")
assert(ingestResult1.results[0].status === "ingested", "ingest: txt file status is ingested")
assert(ingestResult1.results[0].sourceId!.length > 0, "ingest: sourceId generated")
assert(ingestResult1.results[0].evidencePackId!.length > 0, "ingest: evidencePackId generated")

// 10b. Ingest a .md file
const ingestResult2 = JSON.parse((await ingestTool.execute({
  files: [sampleFile2],
  authorizationNote: "QA test corpus — authorized",
}, ingestCtx)).output as string)
assert(ingestResult2.ingested === 1, "ingest: md file ingested")
assert(ingestResult2.results[0].status === "ingested", "ingest: md file status is ingested")

// 10c. Reject unsupported extension
const badFile = join(corpusDir, "bad.pdf")
writeFileSync(badFile, "not a text file", "utf8")
try {
  await ingestTool.execute({ files: [badFile] }, ingestCtx)
  failed++
  console.error("  ✗ FAIL: ingest should reject .pdf files")
} catch (e) {
  if (e instanceof NovelError && e.code === "ERR_UNSUPPORTED_CORPUS_FILE_TYPE") {
    passed++
    console.log("  ✓ PASS: ingest rejects .pdf: ERR_UNSUPPORTED_CORPUS_FILE_TYPE")
  } else {
    failed++
    console.error(`  ✗ FAIL: wrong error: ${String(e)}`)
  }
}

// 10d. File not found
try {
  await ingestTool.execute({ files: ["/nonexistent/file.txt"] }, ingestCtx)
  failed++
  console.error("  ✗ FAIL: ingest should reject nonexistent file")
} catch (e) {
  if (e instanceof Error && (e.message.includes("ENOENT") || e.message.includes("not a file"))) {
    passed++
    console.log("  ✓ PASS: ingest rejects nonexistent file")
  } else {
    failed++
    console.error(`  ✗ FAIL: wrong error: ${String(e)}`)
  }
}

// 10e. Skip duplicate by content hash
const reingestResult = JSON.parse((await ingestTool.execute({
  files: [sampleFile1],
  authorizationNote: "QA test corpus — authorized",
}, ingestCtx)).output as string)
assert(reingestResult.ingested === 0, "ingest: re-ingest has 0 ingested")
assert(reingestResult.skipped === 1, "ingest: re-ingest has 1 skipped")
assert(reingestResult.results[0].status === "skipped", "ingest: duplicate skipped")
assert(reingestResult.results[0].reason === "duplicate_hash", "ingest: skip reason is duplicate_hash")

// 10f. Select evidence to verify packs are retrievable
const selectResult = JSON.parse((await tools.novel_select_evidence.execute({
  stages: ["event_selection"],
}, ingestCtx)).output as string)
assert(selectResult.evidencePacks.length >= 2, "select_evidence: returns ingested evidence packs")
assert(selectResult.totalMatches >= 2, "select_evidence: totalMatches correct")

rmSync(ingestCtx.directory, { recursive: true, force: true })

// ═══════════════════════════════════════════════════════════
// TEST SUITE 11: Record review tool
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 11: Record review ──")

const reviewCtx = makeCtx(mkdtempSync(join(tmpdir(), "novel-qa-review-")))
await tools.novel_init_project.execute({}, reviewCtx)

const reviewTool = tools.novel_record_review
const reviewArtifact2Id = randomUUID()
const reviewArtifact2 = {
  schemaVersion: "1.0.0",
  artifactId: reviewArtifact2Id,
  runId: JSON.parse((await tools.novel_project_status.execute({}, reviewCtx)).output as string).currentRun.runId,
  createdAt: new Date().toISOString(),
  stage: "prose_review",
  status: "fail",
  severity: "blocking",
  blockingIssues: [{ issue: "Character motivation unclear in chapter 3", suggestedFix: "Add internal monologue revealing the protagonist's fear" }],
  nonBlockingSuggestions: ["Vary sentence structure in action scenes"],
  affectedArtifactIds: [],
  artifactHash: "hash-def456",
  reason: "Character arc incomplete; need clearer motivation beats",
  suggestedFix: "Add a scene where the protagonist confronts their past failure",
  requiresUserDecision: false,
  reviewedArtifactId: "draft-002",
  reviewedArtifactHash: "hash-def456",
  reviewedArtifactVersion: 2,
  gate: "logic-world-motivation",
  decision: "revision_required",
  deltas: [],
  reviewerId: "qa-logic-reviewer",
  sourceArtifactIds: [],
}

// 11a. Record a review
const recordResult = JSON.parse((await reviewTool.execute({
  review: reviewArtifact2,
}, reviewCtx)).output as string)
assert(recordResult.recorded === true, "record_review: recorded=true")
assert(recordResult.gate === "logic-world-motivation", "record_review: correct gate")
assert(recordResult.status === "fail", "record_review: correct status")
assert(recordResult.decision === "revision_required", "record_review: correct decision")

// 11b. Review artifact is readable
const recordedReview = JSON.parse((await tools.novel_read_artifact.execute({
  artifact: { kind: "review", artifactId: reviewArtifact2Id },
}, reviewCtx)).output as string)
assert(recordedReview.artifact.gate === "logic-world-motivation", "record_review: persisted review gate correct")
assert(recordedReview.artifact.blockingIssues.length === 1, "record_review: blockingIssues persisted")

rmSync(reviewCtx.directory, { recursive: true, force: true })

// ═══════════════════════════════════════════════════════════
// TEST SUITE 12: Select evidence (without ingest)
// ═══════════════════════════════════════════════════════════
console.log("\n── TEST SUITE 12: Select evidence (empty) ──")

const emptyCtx = makeCtx(mkdtempSync(join(tmpdir(), "novel-qa-empty-")))
await tools.novel_init_project.execute({}, emptyCtx)

const emptySelectResult = JSON.parse((await tools.novel_select_evidence.execute({
  limit: 10,
}, emptyCtx)).output as string)
assert(emptySelectResult.evidencePacks.length === 0, "select_evidence: empty project returns 0 packs")
assert(emptySelectResult.totalMatches === 0, "select_evidence: totalMatches is 0")

rmSync(emptyCtx.directory, { recursive: true, force: true })

// ═══════════════════════════════════════════════════════════
// FINAL VERDICT
// ═══════════════════════════════════════════════════════════
console.log("\n═════════════════════════════════════════════════")
console.log(`  RESULTS: ${passed} passed, ${failed} failed`)
console.log("═════════════════════════════════════════════════")

if (failed > 0) {
  console.log("\n  VERDICT: REJECT — Issues found\n")
  process.exit(1)
} else {
  console.log("\n  VERDICT: APPROVE — All tests passed\n")
  process.exit(0)
}
