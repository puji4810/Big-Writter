---
description: Display the current novel project status, stage, and pending gates
---

<command-instruction>
You are checking the status of a web novel project.

## Steps

1. **Call `novel_project_status`** to get the project state.
2. **Interpret the result**:
   - If `initialized` is `false`: Report "Project not initialized" and tell the user to use `/novel-start` or `novel_init_project` to begin.
   - If `initialized` is `true`: Display:
     - Current stage name
     - Current run summary (run ID, created date)
     - Pending gates (what's needed before the next stage transition)
     - Any artifacts associated with the current run
3. **Format clearly**: Present the information in a readable summary. Use the stage name in a user-friendly format (e.g., "Interviewing" instead of "interviewing").

Do NOT change any state. This is a read-only status check.
</command-instruction>

<user-request>
$ARGUMENTS
</user-request>
