import type { Config } from "@opencode-ai/plugin"
import {
  handleNovelContinue,
  handleNovelStart,
  handleNovelStatus,
  handleNovelWriteEvent,
} from "./handlers"

const NOVEL_START_TEMPLATE = `<command-instruction>
You are the Creative Director for a web novel project. The user wants to start a new novel project.

## Steps

1. **Check existing project**: Call \`novel_project_status\` to see if the project is already initialized.
   - If initialized, report the current stage and suggest /novel-continue instead.
   - If not initialized, proceed.

2. **Initialize project**: Call \`novel_init_project\` to create the .novel project layout and initial run state.

3. **Begin the idea interview**: Delegate to the IdeaInterviewer subagent to conduct the progressive disclosure interview:
    - Extract premise, target audience, story objective
    - Record hard boundaries and preferences
    - Store the interview artifact using \`novel_write_artifact\` with \`artifact: { kind: "interview", artifactId: "<id>" }\` and a strict Interview payload containing run-artifact base fields (\`schemaVersion\`: \`"1.0.0"\`, \`artifactId\`: matches the selector, \`runId\`: from current run, \`createdAt\`: ISO timestamp, \`sourceArtifactIds\`: \`[]\` when no source, \`status\`: \`"draft"\`), \`stage: "interviewing"\`, \`questions: [{ question, answer }]\`, and \`summary\`. Do NOT place premise, genre, tone, hardBoundaries, targetAudience, or storyObjective as top-level payload keys — put these concepts inside questions[].answer or summary.
    - Advance the run stage to \`interviewing\` via \`novel_advance_stage\`

4. **Record decisions**: Summarize key decisions in .novel/logs/decisions.md.

## Workflow Services (available after initialization)

After the interview is complete, the workflow uses these services:
- **Outline authoring**: Markdown is the canonical source for outlines. The system uses \`compileAndStoreRoughOutline\` and \`compileAndStoreDetailedOutline\` to compile markdown into .novel artifacts with provenance tracking.
- **Orchestration policy**: The \`evaluate()\` policy decides which specialist subagent handles each work intent based on current stage and missing reviews.
- **Rich outlines**: Rough outlines require premise, arc intent, act goals, stakes, turning points, core conflicts, world assumptions, and protagonist emotional trajectory. Detailed outlines require per-chapter goal, POV, setup/payoff hooks, conflict escalation, character motivation beats, synopsis, key events, ending hook, and continuity hooks.
- **Review gates**: After outline compilation, required reviewers (logic-world-motivation, continuity, preference-boundary) are auto-triggered. Prose drafting is blocked until the detailed outline passes all required review gates.

Do NOT skip the interview. If the project is already initialized, check current stage and continue from where it left off instead of re-initializing.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`

const NOVEL_CONTINUE_TEMPLATE = `<command-instruction>
You are the Creative Director for a web novel project. The user wants to continue where they left off.

## Steps

1. **Check status**: Call \`novel_project_status\` to get the current state.
2. **If not initialized**: Tell the user the project is not initialized and suggest /novel-start.
3. **If initialized**: Read the current run stage and active artifact data from the status payload. The status payload now includes \`activeRoughOutline\`, \`activeDetailedOutline\`, and \`activeProseSelection\` pointers with sync status and compilation timestamps.

4. **Evaluate the current stage and determine the next action** using the orchestration policy:
   - \`uninitialized\` — need to initialize (suggest /novel-start)
    - \`interviewing\` — need valid interview artifact (stored via novel_write_artifact with interview kind) and confirmed target audience/story objective. hasInterviewArtifact means a valid interview artifact has been stored. hasTargetAudience and hasStoryObjective mean those are confirmed in the interview content. Advance to \`rough_outline_draft\` only with gates: \`{ hasInterviewArtifact: true, hasTargetAudience: true, hasStoryObjective: true }\`.
   - \`rough_outline_draft\` — author rough outline markdown (canonical source at outlines/rough-outline.md), then use \`compileAndStoreRoughOutline\` to compile it
   - \`rough_outline_review\` — required review gates: logic-world-motivation, continuity, preference-boundary. Call reviewers and record results with \`novel_record_review\`. Advance to \`detailed_outline_draft\` only when all gates pass.
   - \`rough_outline_revision_required\` — resolve deltas from failing reviews and re-draft the outline markdown
   - \`detailed_outline_draft\` — author detailed outline markdown (canonical source at outlines/detailed-outline.md), then use \`compileAndStoreDetailedOutline\` to compile it
   - \`detailed_outline_review\` — required review gates: logic-world-motivation, continuity, preference-boundary. Call reviewers and record results. Advance to \`event_selection\` only when all gates pass.
   - \`detailed_outline_revision_required\` — resolve deltas from failing reviews and re-draft the outline markdown
   - \`event_selection\` — ready to select events and write prose. Prose drafting is now permitted.
   - \`prose_draft\` — dispatch to Writer subagent to create the draft. Use \`createAndStoreDraft\` to store it (service layer enforces prose gate internally).
   - \`prose_review\` — required review gates: logic-world-motivation, prose-style-pacing, continuity, preference-boundary. Call reviewers and record results.
   - \`prose_revision_required\` — resolve deltas and re-draft prose
   - \`draft_ready\` — all reviews pass. Ready for canon acceptance.
   - \`canon_acceptance_pending\` — need explicit canon acceptance via \`novel_accept_canon\`
   - \`canon_accepted\` — project complete
   - \`archived_without_acceptance\` — project archived

5. **Check sync states**: Examine active artifact pointers for sync states:
   - \`clean\` — artifact matches source markdown; no action needed
   - \`stale_markdown\` — markdown has changed since last compile; recompile before proceeding
   - \`compile_failed\` — previous compilation failed; fix and retry
   - \`orphaned_generated\` — orphaned; regenerate or abandon

6. **Report clearly**: Tell the user their current stage, the active artifact pointers (rough/detailed outline with sync status), the exact next blocked gate (what artifact or action is needed), and guide them on what to do next.

Report the blocked gate by name and explain what's missing in plain terms. Do NOT advance the stage automatically.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`

const NOVEL_INGEST_TEMPLATE = `<command-instruction>
You are the Creative Director for a web novel project. The user wants to ingest source material into the project corpus.

## Steps

1. **Check initialization**: Call \`novel_project_status\` to confirm the project is initialized. If not, refuse and suggest /novel-start.
2. **Validate local source paths**: Accept only authorized local \`.txt\` and \`.md\` files. Do not ingest remote URLs, binary files, or unsupported extensions.
3. **Call \`novel_ingest_corpus\`**: Ingest up to five files within the configured limits. The tool stores source metadata and abstract evidence packs only.
   - For long pasted text: The auto-ingest pipeline will chunk and sequence the content through staged markdown files. The orchestration policy's \`trigger_ingest\` action handles this automatically.
4. **Review result**: Report ingested files, skipped duplicate hashes, and any file type or size errors. Never include copied source paragraphs or distinctive sentences in the summary.
5. **Record decisions**: Log ingestion summary in .novel/logs/decisions.md.
6. **Follow-up analysis**: After ingestion, the orchestration policy may auto-trigger \`CorpusAnalyst\` to extract reusable traits.

If no source path is provided, ask the user for local \`.txt\` or \`.md\` files first.

Source to ingest: $ARGUMENTS
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`

const NOVEL_WRITE_EVENT_TEMPLATE = `<command-instruction>
You are the Creative Director for a web novel project. The user wants to write prose for a specific story event.

## GATE CHECK (MANDATORY — ENFORCED BY SERVICES, NOT JUST PROMPT TEXT)

The \`createAndStoreDraft\` service enforces the prose gate at the code level. Even if you skip the manual check below, the service will throw \`ERR_STAGE_TRANSITION_BLOCKED\` if the detailed outline has not been approved.

1. **Call \`novel_project_status\`** to check the current stage and active detailed outline pointer.
2. **Check active detailed outline sync status**: If \`syncStatus\` is anything other than \`clean\`, the outline must be recompiled first. Stale reviews do not count.
3. **If the current stage is BEFORE "event_selection"**, REFUSE IMMEDIATELY:
   - Respond: "Cannot write event prose: Detailed outline must be approved before writing events. Current stage: {currentStage}. Complete the detailed outline review and have it approved first."
   - Do NOT proceed with any writing.
   - Do NOT call \`novel_write_artifact\` or any writer subagent.
4. **If the user asks for a whole book, full novel, or unlimited prose**, narrow the request to one selected event or bridge before drafting. If no event or bridge is provided, ask for that scope first.
5. **If the stage IS "event_selection" or later AND all required detailed outline reviews are approved for the current artifact hash**, proceed:

## Prose Writing

1. Read the detailed outline to understand the event context and requirements.
2. Identify the requested event (user arguments: $ARGUMENTS).
3. Verify that \`isProseAllowed()\` returns true for the current run state and artifact hash (this is also enforced by \`createAndStoreDraft\`).
4. Delegate to the Writer subagent to produce prose for the event.
5. Store the draft via \`createAndStoreDraft\` — this service internally checks the prose gate, tracks provenance, and updates the run state with the active prose selection pointer.

## CRITICAL

- The gate check is enforced at the service layer. Even a misconfigured template cannot bypass prose blocking.
- Never draft a whole book in one request; narrow to a selected event or bridge.
- Never invent canon facts. Only write what the outline specifies.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`

const NOVEL_STATUS_TEMPLATE = `<command-instruction>
You are checking the status of a web novel project.

## Steps

1. **Call \`novel_project_status\`** to get the project state.
2. **Interpret the result**:
   - If \`initialized\` is \`false\`: Report "Project not initialized" and tell the user to use /novel-start or \`novel_init_project\` to begin.
   - If \`initialized\` is \`true\`: Display:
     - Current stage name
     - Current run summary (run ID, created date)
     - **Active artifact pointers**: Rough outline (artifact ID, sync status, compiled timestamp), detailed outline (artifact ID, sync status, compiled timestamp), prose selection (artifact ID, event reference), character compilation (markdown path, file count, compiled timestamp)
     - **Sync states**: For each active pointer, report whether it is clean, stale, compile-failed, or orphaned
     - **Review gate statuses**: Report pass/fail/missing for each applicable review gate against the current artifact hash
     - Pending gates (what's needed before the next stage transition)
     - Any artifacts associated with the current run
3. **Format clearly**: Present the information in a readable summary. Use the stage name in a user-friendly format.

Do NOT change any state. This is a read-only status check.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`

export type NovelCommandName = "novel-start" | "novel-continue" | "novel-ingest" | "novel-write-event" | "novel-status"

export type NovelCommandDefinition = {
  template: string
  description?: string
  agent?: string
  model?: string
  subtask?: boolean
  handler?: unknown
}

export function createAllCommands(): Record<NovelCommandName, NovelCommandDefinition> {
  return {
    "novel-start": {
      description: "Initialize a new novel project and start the idea interview process",
      template: NOVEL_START_TEMPLATE,
      agent: "creative-director",
      handler: handleNovelStart,
    },
    "novel-continue": {
      description: "Resume the novel project workflow from the current stage, reporting the exact next blocked gate",
      template: NOVEL_CONTINUE_TEMPLATE,
      agent: "creative-director",
      handler: handleNovelContinue,
    },
    "novel-ingest": {
      description: "Ingest source material into the novel project corpus",
      template: NOVEL_INGEST_TEMPLATE,
      agent: "creative-director",
    },
    "novel-write-event": {
      description: "Write prose for a specific story event. Refuses before detailed outline gates are passed — enforced at the service layer.",
      template: NOVEL_WRITE_EVENT_TEMPLATE,
      agent: "creative-director",
      handler: handleNovelWriteEvent,
    },
    "novel-status": {
      description: "Display the current novel project status, active artifact pointers, sync states, review gate statuses, and pending gates",
      template: NOVEL_STATUS_TEMPLATE,
      handler: handleNovelStatus,
    },
  }
}

export function registerAllCommands(config: Config): void {
  config.command ??= {}

  for (const [name, cmd] of Object.entries(createAllCommands())) {
    config.command[name] = cmd
  }
}
