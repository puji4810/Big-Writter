import type { Config } from "@opencode-ai/plugin"

const NOVEL_START_TEMPLATE = `<command-instruction>
You are the Creative Director for a web novel project. The user wants to start a new novel project.

## Steps

1. **Initialize project**: Call \`novel_init_project\` to create the .novel project layout and initial run state.
2. **Update title**: If the user provided a title in their arguments, update .novel/project.json with \`novel_write_artifact\`.
3. **Begin the idea interview**: Delegate to the IdeaInterviewer subagent to conduct the progressive disclosure interview:
   - Extract premise, target audience, story objective
   - Record hard boundaries and preferences
   - Store the interview artifact
   - Advance the run stage to \`interviewing\` via \`novel_advance_stage\`
4. **Record decisions**: Summarize key decisions in .novel/logs/decisions.md.

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
3. **If initialized**: Read the current run stage from the status payload.
4. **Identify blocked gate**: Using the current stage, determine what gates are blocking the next transition:
   - \`uninitialized\` - need to initialize (suggest /novel-start)
   - \`interviewing\` - need interview artifact, target audience, story objective
   - \`rough_outline_draft\` - need rough outline draft
   - \`rough_outline_review\` - need a review decision
   - \`rough_outline_revision_required\` - need to resolve deltas and re-draft
   - \`detailed_outline_draft\` - need detailed outline draft
   - \`detailed_outline_review\` - need a review decision
   - \`detailed_outline_revision_required\` - need to resolve deltas and re-draft
   - \`event_selection\` - ready to select events and write prose
   - \`prose_draft\` - need prose draft
   - \`prose_review\` - need a review decision
   - \`prose_revision_required\` - need to resolve deltas and re-draft
   - \`draft_ready\` - ready for canon acceptance
   - \`canon_acceptance_pending\` - need explicit canon acceptance
   - \`canon_accepted\` - project complete
   - \`archived_without_acceptance\` - project archived

5. **Report clearly**: Tell the user their current stage, the exact next blocked gate (what artifact or action is needed), and guide them on what to do next.

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
4. **Review result**: Report ingested files, skipped duplicate hashes, and any file type or size errors. Never include copied source paragraphs or distinctive sentences in the summary.
5. **Record decisions**: Log ingestion summary in .novel/logs/decisions.md.

If no source path is provided, ask the user for local \`.txt\` or \`.md\` files first.

Source to ingest: $ARGUMENTS
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>`

const NOVEL_WRITE_EVENT_TEMPLATE = `<command-instruction>
You are the Creative Director for a web novel project. The user wants to write prose for a specific story event.

## GATE CHECK (MANDATORY - DO NOT SKIP)

1. **Call \`novel_project_status\`** to check the current stage.
2. **If the current stage is BEFORE "event_selection"** (i.e., it is any stage that comes before \`event_selection\` in the workflow), **REFUSE IMMEDIATELY**:
   - Respond: "Cannot write event prose: Detailed outline must be approved before writing events. Current stage: {currentStage}. Complete the detailed outline review and have it approved first."
   - Do NOT proceed with any writing.
   - Do NOT call \`novel_write_artifact\` or any writer subagent.
3. **If the user asks for a whole book, full novel, or unlimited prose**, narrow the request to one selected event or bridge before drafting. If no event or bridge is provided, ask for that scope first.
4. **If the stage IS "event_selection" or later**, proceed:

## Prose Writing

1. Read the detailed outline to understand the event context and requirements.
2. Identify the requested event (user arguments: $ARGUMENTS).
3. Delegate to the Writer subagent to produce prose for the event.
4. Store the draft via \`novel_write_artifact\` as \`draft\` kind.
5. Advance the run stage to \`prose_draft\` via \`novel_advance_stage\` if not already in \`prose_draft\`.

## CRITICAL

- The gate check in step 2 is non-negotiable. If the detailed outline has not been approved (stage < event_selection), you MUST refuse.
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
}

export function createAllCommands(): Record<NovelCommandName, NovelCommandDefinition> {
  return {
    "novel-start": {
      description: "Initialize a new novel project and start the idea interview process",
      template: NOVEL_START_TEMPLATE,
      agent: "creative-director",
    },
    "novel-continue": {
      description: "Resume the novel project workflow from the current stage, reporting the exact next blocked gate",
      template: NOVEL_CONTINUE_TEMPLATE,
      agent: "creative-director",
    },
    "novel-ingest": {
      description: "Ingest source material into the novel project corpus",
      template: NOVEL_INGEST_TEMPLATE,
      agent: "creative-director",
    },
    "novel-write-event": {
      description: "Write prose for a specific story event. Refuses before detailed outline gates are passed.",
      template: NOVEL_WRITE_EVENT_TEMPLATE,
      agent: "creative-director",
    },
    "novel-status": {
      description: "Display the current novel project status, stage, and pending gates",
      template: NOVEL_STATUS_TEMPLATE,
    },
  }
}

export function registerAllCommands(config: Config): void {
  config.command ??= {}

  for (const [name, cmd] of Object.entries(createAllCommands())) {
    config.command[name] = cmd
  }
}
