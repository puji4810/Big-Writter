import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { StageSchema } from "../../schemas"
import { initNovelProject, writeArtifact } from "../../storage"
import { createAllTools } from "../../tools"
import { createAllCommands, registerAllCommands } from ".."

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

describe("novel commands", () => {
  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), "novel-commands-"))
  })

  afterEach(() => {
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true })
    }
  })

  // #given createAllCommands is called
  // #when the result is inspected
  // #then it contains exactly 5 command names in sorted order
  test("createAllCommands returns exactly five commands", () => {
    const commands = createAllCommands()

    expect(Object.keys(commands).sort()).toEqual([
      "novel-continue",
      "novel-ingest",
      "novel-start",
      "novel-status",
      "novel-write-event",
    ])
  })

  // #given createAllCommands returns command definitions
  // #when each definition is inspected
  // #then each has a template and description
  test("each command has template and description", () => {
    const commands = createAllCommands()

    for (const [name, cmd] of Object.entries(commands)) {
      expect(cmd.template).toBeDefined()
      expect(cmd.template.length).toBeGreaterThan(0)
      expect(cmd.description).toBeDefined()
      expect(cmd.description!.length).toBeGreaterThan(0)
    }
  })

  // #given a config object with commands
  // #when registerAllCommands is called
  // #then all five commands are registered
  test("registerAllCommands adds five commands to config", () => {
    const config: Record<string, unknown> = {}

    registerAllCommands(config as never)

    expect(config.command).toBeDefined()
    const commands = config.command as Record<string, unknown>
    expect(Object.keys(commands).sort()).toEqual([
      "novel-continue",
      "novel-ingest",
      "novel-start",
      "novel-status",
      "novel-write-event",
    ])
  })

  // #given registerAllCommands is called on a config that already has commands
  // #when commands are merged
  // #then existing commands are preserved and new ones added
  test("registerAllCommands merges with existing commands", () => {
    const config: Record<string, unknown> = {
      command: { "existing-cmd": { template: "existing" } },
    }

    registerAllCommands(config as never)

    const commands = config.command as Record<string, unknown>
    expect(commands["existing-cmd"]).toBeDefined()
    expect(commands["novel-start"]).toBeDefined()
  })

  // #given the novel-status command template
  // #when inspected
  // #then it contains instructions for uninitialized project handling
  test("novel-status template handles uninitialized projects", () => {
    const commands = createAllCommands()
    const template = commands["novel-status"].template

    expect(template).toContain("Project not initialized")
    expect(template).toContain("novel_project_status")
    expect(template).toContain("read-only")
  })

  // #given the novel-write-event command template
  // #when inspected
  // #then it contains mandatory gate check instructions that refuse before event_selection
  test("novel-write-event template enforces detailed outline gate", () => {
    const commands = createAllCommands()
    const template = commands["novel-write-event"].template

    expect(template).toContain("GATE CHECK")
    expect(template).toContain("event_selection")
    expect(template).toContain("REFUSE")
    expect(template).toContain("Cannot write event prose")
    expect(template).toContain("novel_project_status")
  })

  // #given the novel-continue command template
  // #when inspected
  // #then it contains stage-specific blocked gate reporting for every stage
  test("novel-continue template reports exact blocked gate per stage", () => {
    const commands = createAllCommands()
    const template = commands["novel-continue"].template

    // Must reference novel_project_status
    expect(template).toContain("novel_project_status")

    // Must reference all stage-named gates
    const stages = StageSchema.options
    for (const stage of stages) {
      expect(template).toContain(stage)
    }
  })

  // #given the novel-start command template
  // #when inspected
  // #then it routes to creative-director and covers initialization + interview
  test("novel-start template covers init and interview", () => {
    const commands = createAllCommands()
    const template = commands["novel-start"].template

    expect(template).toContain("novel_init_project")
    expect(template).toContain("IdeaInterviewer")
    expect(commands["novel-start"].agent).toBe("creative-director")
  })

  // #given the novel-ingest command template
  // #when inspected
  // #then it handles local source material through the ingest tool
  test("novel-ingest template handles corpus ingestion", () => {
    const commands = createAllCommands()
    const template = commands["novel-ingest"].template

    expect(template).toContain("novel_project_status")
    expect(template).toContain("novel_ingest_corpus")
    expect(template).toContain("abstract evidence packs")
    expect(commands["novel-ingest"].agent).toBe("creative-director")
  })

  // #given the plugin creates commands
  // #when the tool reports status before init
  // #then the tool returns initialized=false
  test("status before init returns not initialized via tool", async () => {
    const tools = createAllTools()

    const output = parseToolOutput(await tools.novel_project_status.execute({}, ctx()))

    expect(output.initialized).toBe(false)
    expect(output.nextAction).toBe("/novel-start or novel_init_project")
  })

  // #given a project in rough_outline_draft
  // #when advance_stage is called targeting event_selection directly
  // #then it is blocked because review gates are missing
  test("advancing to event_selection before detailed outline approval is blocked", async () => {
    const project = await initNovelProject(projectRoot)
    const tools = createAllTools()

    // Set stage to rough_outline_draft
    const now = new Date().toISOString()
    await writeArtifact("runs/current.json", {
      schemaVersion: "1.0.0",
      runId: "run-1",
      projectId: project.projectId,
      stage: "rough_outline_draft",
      artifactIds: [],
      updatedAt: now,
    }, projectRoot)

    try {
      await tools.novel_advance_stage.execute({ to: "event_selection" }, ctx())
      throw new Error("Expected transition failure")
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      const novelError = error as { code?: string; message?: string }
      expect(novelError.code).toBe("ERR_STAGE_TRANSITION_BLOCKED")
    }
  })
})
