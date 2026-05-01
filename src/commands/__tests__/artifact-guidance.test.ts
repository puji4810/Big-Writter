import { describe, expect, test } from "bun:test"
import { createAllCommands } from ".."

describe("command artifact guidance", () => {
  test("/novel-start template names novel_write_artifact and interview fields", () => {
    const commands = createAllCommands()
    const template = commands["novel-start"].template

    expect(template).toContain("novel_write_artifact")
    expect(template).toContain('kind: "interview"')
    expect(template).toContain("questions")
    expect(template).toContain("summary")
    expect(template).toContain("interviewing")
  })

  test("/novel-continue inline template names all three interviewing gates", () => {
    const commands = createAllCommands()
    const template = commands["novel-continue"].template

    expect(template).toContain("hasInterviewArtifact")
    expect(template).toContain("hasTargetAudience")
    expect(template).toContain("hasStoryObjective")
  })

  test("novel-continue.md markdown template names all three interviewing gates", async () => {
    const mdText = await Bun.file(new URL("../novel-continue.md", import.meta.url)).text()

    expect(mdText).toContain("hasInterviewArtifact")
    expect(mdText).toContain("hasTargetAudience")
    expect(mdText).toContain("hasStoryObjective")
  })

  test("inline and markdown continue templates do not contradict each other on gates", () => {
    const commands = createAllCommands()
    const inlineTemplate = commands["novel-continue"].template

    const inlineHasGates =
      inlineTemplate.includes("hasInterviewArtifact") &&
      inlineTemplate.includes("hasTargetAudience") &&
      inlineTemplate.includes("hasStoryObjective")

    expect(inlineHasGates).toBe(true)
  })
})
