import { describe, expect, test } from "bun:test";
import { SCHEMA_VERSION } from "../../schemas";
import type { RunState } from "../../schemas";
import {
  compileRichRoughOutline,
  compileRichDetailedOutline,
} from "../outline-compiler";
import type { CompileRichOptions } from "../outline-compiler";

const createdAt = "2026-05-01T00:00:00.000Z";

function runState(stage: RunState["stage"]): RunState {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: "run-test-rich-1",
    projectId: "project-test-rich-1",
    stage,
    artifactIds: [],
    updatedAt: createdAt,
  };
}

const FULL_ROUGH_MARKDOWN = [
  "## Premise/Logline",
  "A courier returns a lost vow across a fading-magic world.",
  "",
  "## Arc Intent",
  "The story follows a reluctant courier whose delivery of an ancient vow forces him to confront the lies that sustain his crumbling kingdom.",
  "",
  "## Acts",
  "### Act 1: The Vow",
  "#### Goals",
  "Establish the courier's world and the vow's urgency. Introduce the central mystery.",
  "#### Stakes",
  "The vow will fade within three days. Failure means the kingdom's last magical protection collapses.",
  "#### Key Events",
  "- Courier receives the vow from a cloaked figure.\n- First crossing attempt fails.\n- Courier discovers the vow speaks to him.",
  "",
  "### Act 2: The Crossing",
  "#### Goals",
  "Force the courier to confront impossible terrain and deceptive allies. Deepen the mystery.",
  "#### Stakes",
  "Allied forces are revealed as compromised. The courier's own bloodline is tied to the vow's origin.",
  "#### Key Events",
  "- Courier crosses the Salt Flats with a traitor in tow.\n- Ambush at the Meridian Bridge.\n- The vow reveals its true cost: the courier's memories.",
  "",
  "### Act 3: The Delivery",
  "#### Goals",
  "Resolve the central conflict. The courier must choose between the vow and his identity.",
  "#### Stakes",
  "Delivering the vow means erasing himself. Not delivering means the kingdom falls. The courier finds a third path.",
  "#### Key Events",
  "- Final confrontation at the Spire.\n- The courier rewrites the vow's terms.\n- Kingdom saved; courier becomes the new vow-keeper.",
  "",
  "## Core Conflicts",
  "Man vs self: the courier's fear of erasure. Man vs system: a kingdom built on magical lies. Man vs nature: the fading-magic world.",
  "",
  "## World Assumptions",
  "Magic once saturated the land but has been draining for two centuries. Vows are the last remaining vessels for true magic. Each delivered vow costs something personal from its bearer.",
  "",
  "## Protagonist Emotional Trajectory",
  "Reluctant duty → growing fear as the cost becomes clear → despair when he learns the truth → determined acceptance → transcendent choice.",
].join("\n");

const FULL_DETAILED_MARKDOWN = [
  "## Chapter 1: The Cloaked Courier",
  "### Chapter Goal",
  "Introduce the courier, the vow, and the world's central tension.",
  "### POV/Focus",
  "Third person limited, courier's POV.",
  "### Setup/Payoff",
  "The vow's voice is introduced subtly — payoff in Act 3 when it demands the courier's name.",
  "### Conflict Escalation",
  "The courier is warned not to take this job by a fellow runner.",
  "### World/Canon Dependencies",
  "Magic is draining from the world. The courier's guild has dwindled to a handful.",
  "### Character Motivation Beats",
  "The courier needs coin for his sick sister's medicine.",
  "### Synopsis",
  "A courier receives a mysterious vow from a cloaked figure in the rain. Every other runner refused the job. He takes it for the coin but the vow's first whisper chills him to the bone.",
  "### Key Events",
  "- Courier arrives at guild hall and is the only runner present.\n- Cloaked figure enters, offers a sealed leather case.\n- Courier takes the job despite warnings.\n- First whisper from the vow as he steps into the rain.",
  "### Ending Hook",
  "The vow speaks his name — a name no one else knows.",
  "### Continuity Hooks",
  "The cloaked figure will return at the Spire. The sister's illness ties to the magic drain.",
  "",
  "## Chapter 2: The Salt Flats",
  "### Chapter Goal",
  "Raise stakes through environmental danger and introduce the traitor ally.",
  "### POV/Focus",
  "Third person limited, courier's POV with brief inset to the traitor's perspective.",
  "### Setup/Payoff",
  "The traitor plants a tracking charm — payoff when the ambush strikes at the Meridian Bridge.",
  "### Conflict Escalation",
  "The Salt Flats are actively hostile: salt storms, memory-eating mirages.",
  "### World/Canon Dependencies",
  "Salt Flats lore: the remains of an ancient sea, its salt imbued with the last echoes of drowned magic. Tracking charms are illegal but common among spies.",
  "### Character Motivation Beats",
  "The courier begins to trust the traitor out of loneliness and exhaustion.",
  "### Synopsis",
  "The courier and a fellow runner cross the Salt Flats together. The traitor plants a charm while the courier sleeps. Salt mirages force the courier to relive a childhood memory of his sister falling ill.",
  "### Key Events",
  "- Departure into the Salt Flats at dawn.\n- Salt storm forces them to shelter.\n- Traitor plants the tracking charm.\n- Salt mirage: courier sees his sister's first fever dream.",
  "### Ending Hook",
  "The courier wakes gasping. The vow's whisper is louder now — it knows what the mirage showed.",
  "### Continuity Hooks",
  "The traitor's signal reaches the ambush party. The sister's illness origin tied to the magic drain is foreshadowed.",
  "",
  "## Chapter 3: The Spire",
  "### Chapter Goal",
  "Deliver the climax: the courier faces the sender, learns the truth, and rewrites the vow.",
  "### POV/Focus",
  "Third person limited, courier's POV.",
  "### Setup/Payoff",
  "The vow's true nature is revealed: it is a soul-vessel containing the last mage. The cloaked figure is the mage's apprentice trying to free her.",
  "### Conflict Escalation",
  "Everything the courier has been told was wrong. The kingdom's magic drain was caused by the king imprisoning mages in vows.",
  "### World/Canon Dependencies",
  "Mage-imprisonment lore. The Spire as a prison / relay station. The king's original sin: binding mages to save himself.",
  "### Character Motivation Beats",
  "The courier must decide: deliver the vow and erase himself so the mage can go free, or refuse and let the kingdom crumble. He chooses a third path — binding himself as the vow's permanent keeper, not its victim.",
  "### Synopsis",
  "The courier reaches the Spire. The cloaked figure reveals everything. The courier performs the rewrite ritual, forging a new type of vow — one sustained by voluntary service rather than sacrifice.",
  "### Key Events",
  "- Arrival at the Spire.\n- Confrontation with the cloaked figure who is the mage's apprentice.\n- The truth: the king imprisoned mages in vows to sustain magic.\n- Courier chooses to become the vow's keeper.\n- Rewrite ritual succeeds. The mage is freed. Magic stabilizes.",
  "### Ending Hook",
  "The courier stands alone atop the Spire, the vow now silent but heavy — he carries it forever. The first rain in a century begins to fall.",
  "### Continuity Hooks",
  "The freed mage sets out to find other imprisoned mages. The king's forces are now hunting the Spire.",
].join("\n");

const SINGLE_ACT_ROUGH = [
  "## Premise/Logline",
  "A courier returns a lost vow.",
  "",
  "## Arc Intent",
  "The story follows a courier.",
  "",
  "## Acts",
  "### Act 1: The Vow",
  "#### Goals",
  "Establish the world.",
  "#### Stakes",
  "The vow must be delivered.",
  "#### Key Events",
  "- Courier receives the vow.",
  "",
  "## Core Conflicts",
  "Man vs nature.",
  "",
  "## World Assumptions",
  "Magic is fading.",
  "",
  "## Protagonist Emotional Trajectory",
  "From reluctant to determined.",
].join("\n");

const EMPTY_ACT_CONTENT_ROUGH = [
  "## Premise/Logline",
  "A courier returns a lost vow.",
  "",
  "## Arc Intent",
  "The story follows a courier.",
  "",
  "## Acts",
  "### Act 1: The Vow",
  "#### Goals",
  "",
  "#### Stakes",
  "The vow must be delivered.",
  "#### Key Events",
  "- Courier receives the vow.",
  "",
  "### Act 2: The Crossing",
  "#### Goals",
  "Cross the salt flats.",
  "#### Stakes",
  "",
  "#### Key Events",
  "- Ambush at the bridge.",
  "",
  "## Core Conflicts",
  "Man vs nature.",
  "",
  "## World Assumptions",
  "Magic is fading.",
  "",
  "## Protagonist Emotional Trajectory",
  "From reluctant to determined.",
].join("\n");

const EMPTY_TOP_SECTIONS_ROUGH = [
  "## Premise/Logline",
  "",
  "",
  "## Arc Intent",
  "The story follows a courier.",
  "",
  "## Acts",
  "### Act 1: The Vow",
  "#### Goals",
  "Establish the world.",
  "#### Stakes",
  "The vow must be delivered.",
  "#### Key Events",
  "- Courier receives the vow.",
  "",
  "### Act 2: The Crossing",
  "#### Goals",
  "Cross the salt flats.",
  "#### Stakes",
  "Survival.",
  "#### Key Events",
  "- Ambush at the bridge.",
  "",
  "## Core Conflicts",
  "",
  "",
  "## World Assumptions",
  "Magic is fading.",
  "",
  "## Protagonist Emotional Trajectory",
  "From reluctant to determined.",
].join("\n");

const EMPTY_CHAPTER_FIELDS_DETAILED = [
  "## Chapter 1: The Vow Received",
  "### Chapter Goal",
  "Introduce the courier.",
  "### POV/Focus",
  "Third person.",
  "### Setup/Payoff",
  "",
  "### Conflict Escalation",
  "The courier is warned.",
  "### World/Canon Dependencies",
  "Magic is fading.",
  "### Character Motivation Beats",
  "The courier needs money.",
  "### Synopsis",
  "A courier receives a vow.",
  "### Key Events",
  "- Courier receives vow.",
  "### Ending Hook",
  "Someone watches.",
  "### Continuity Hooks",
  "The watcher returns.",
].join("\n");

const MISSING_SECTIONS_DETAILED = [
  "## Chapter 1: The Vow Received",
  "### Chapter Goal",
  "Introduce the courier.",
  "### POV/Focus",
  "Third person.",
  "### Conflict Escalation",
  "The courier is warned.",
  "### World/Canon Dependencies",
  "Magic is fading.",
  "### Character Motivation Beats",
  "The courier needs money.",
  "### Synopsis",
  "A courier receives a vow.",
  "### Key Events",
  "- Courier receives vow.",
  "### Ending Hook",
  "Someone watches.",
  "### Continuity Hooks",
  "The watcher returns.",
].join("\n");

const options: CompileRichOptions = { sourcePath: "authored/rough-outline.md" };
const detailedOptions: CompileRichOptions = { sourcePath: "authored/detailed-outline.md" };

describe("compileRichRoughOutline", () => {
  test("compiles valid rich rough outline with all review-target sections", () => {
    const run = runState("rough_outline_draft");
    const result = compileRichRoughOutline(FULL_ROUGH_MARKDOWN, run, options);

    expect(result.sourcePath).toBe("authored/rough-outline.md");
    expect(result.markdownHash).toHaveLength(64);
    expect(result.templateVersion).toBe("1.0.0");
    expect(typeof result.compiledAt).toBe("string");
    expect(new Date(result.compiledAt).getTime()).toBeGreaterThan(0);

    expect(result.premiseLogline).toContain("courier");
    expect(result.arcIntent).toContain("confront");
    expect(result.acts).toHaveLength(3);

    const act1 = result.acts[0];
    expect(act1.title).toBe("Act 1: The Vow");
    expect(act1.goals).toContain("Establish");
    expect(act1.stakes).toContain("three days");
    expect(act1.keyEvents).toContain("cloaked figure");
    expect(act1.keyEventsList).toHaveLength(3);
    expect(act1.keyEventsList[0]).toBe("Courier receives the vow from a cloaked figure.");

    const act2 = result.acts[1];
    expect(act2.title).toBe("Act 2: The Crossing");
    expect(act2.keyEventsList).toHaveLength(3);

    const act3 = result.acts[2];
    expect(act3.title).toBe("Act 3: The Delivery");
    expect(act3.keyEventsList).toHaveLength(3);

    expect(result.coreConflicts).toContain("Man vs self");
    expect(result.worldAssumptions).toContain("draining");
    expect(result.protagonistEmotionalTrajectory).toContain("transcendent");
  });

  test("all review-target sections are present in compiled output", () => {
    const run = runState("rough_outline_draft");
    const result = compileRichRoughOutline(FULL_ROUGH_MARKDOWN, run, options);

    const reviewTargets: (keyof typeof result)[] = [
      "premiseLogline",
      "arcIntent",
      "acts",
      "coreConflicts",
      "worldAssumptions",
      "protagonistEmotionalTrajectory",
    ];

    for (const key of reviewTargets) {
      expect(result[key]).toBeDefined();
      if (key === "acts") {
        expect(result[key]).toHaveLength(3);
      } else {
        expect(typeof result[key]).toBe("string");
        expect((result[key] as string).length).toBeGreaterThan(0);
      }
    }
  });

  test("rejects outline with fewer than 2 acts", () => {
    const run = runState("rough_outline_draft");
    expect(() =>
      compileRichRoughOutline(SINGLE_ACT_ROUGH, run, options),
    ).toThrow("at least 2 acts");
  });

  test("rejects outline with empty act content", () => {
    const run = runState("rough_outline_draft");
    expect(() =>
      compileRichRoughOutline(EMPTY_ACT_CONTENT_ROUGH, run, options),
    ).toThrow("Act \"Act 1: The Vow\" has empty goals");
  });

  test("rejects outline with empty top-level sections", () => {
    const run = runState("rough_outline_draft");
    expect(() =>
      compileRichRoughOutline(EMPTY_TOP_SECTIONS_ROUGH, run, options),
    ).toThrow("Premise/Logline is empty");
  });

  test("rejects markdown with missing required sections", () => {
    const run = runState("rough_outline_draft");
    const bad = "## Only\none section here.";
    expect(() => compileRichRoughOutline(bad, run, options)).toThrow(
      "Rich rough outline parsing failed",
    );
  });

  test("provenance metadata is populated correctly", () => {
    const run = runState("rough_outline_draft");
    const result = compileRichRoughOutline(FULL_ROUGH_MARKDOWN, run, {
      sourcePath: "authored/rough-outline.md",
      templateVersion: "2.0.0",
    });

    expect(result.sourcePath).toBe("authored/rough-outline.md");
    expect(result.templateVersion).toBe("2.0.0");
    expect(result.markdownHash).toHaveLength(64);
    const compiledDate = new Date(result.compiledAt);
    const now = new Date();
    expect(Math.abs(now.getTime() - compiledDate.getTime())).toBeLessThan(5000);
  });

  test("parses key events into structured list", () => {
    const run = runState("rough_outline_draft");
    const result = compileRichRoughOutline(FULL_ROUGH_MARKDOWN, run, options);

    const act1Events = result.acts[0].keyEventsList;
    expect(act1Events).toEqual([
      "Courier receives the vow from a cloaked figure.",
      "First crossing attempt fails.",
      "Courier discovers the vow speaks to him.",
    ]);
  });
});

describe("compileRichDetailedOutline", () => {
  test("compiles valid rich detailed outline with all per-chapter sections", () => {
    const run = runState("detailed_outline_draft");
    const result = compileRichDetailedOutline(
      FULL_DETAILED_MARKDOWN,
      run,
      detailedOptions,
    );

    expect(result.sourcePath).toBe("authored/detailed-outline.md");
    expect(result.markdownHash).toHaveLength(64);
    expect(result.templateVersion).toBe("1.0.0");
    expect(new Date(result.compiledAt).getTime()).toBeGreaterThan(0);
    expect(result.chapters).toHaveLength(3);

    const ch1 = result.chapters[0];
    expect(ch1.chapterNumber).toBe(1);
    expect(ch1.title).toBe("The Cloaked Courier");
    expect(ch1.goal).toContain("Introduce");
    expect(ch1.povFocus).toContain("Third person");
    expect(ch1.setupPayoff).toContain("payoff in Act 3");
    expect(ch1.conflictEscalation).toContain("warned");
    expect(ch1.worldCanonDependencies).toContain("draining");
    expect(ch1.characterMotivationBeats).toContain("medicine");
    expect(ch1.synopsis).toContain("cloaked figure");
    expect(ch1.keyEvents).toContain("Courier arrives");
    expect(ch1.endingHook).toContain("knows");
    expect(ch1.continuityHooks).toContain("Spire");

    expect(ch1.keyEventsList).toHaveLength(4);
    expect(ch1.keyEventsList[0]).toBe(
      "Courier arrives at guild hall and is the only runner present.",
    );

    const ch2 = result.chapters[1];
    expect(ch2.chapterNumber).toBe(2);
    expect(ch2.title).toBe("The Salt Flats");

    const ch3 = result.chapters[2];
    expect(ch3.chapterNumber).toBe(3);
    expect(ch3.title).toBe("The Spire");
  });

  test("all per-chapter review-target sections present in every chapter", () => {
    const run = runState("detailed_outline_draft");
    const result = compileRichDetailedOutline(
      FULL_DETAILED_MARKDOWN,
      run,
      detailedOptions,
    );

    for (const chapter of result.chapters) {
      expect(chapter.goal.length).toBeGreaterThan(0);
      expect(chapter.povFocus.length).toBeGreaterThan(0);
      expect(chapter.setupPayoff.length).toBeGreaterThan(0);
      expect(chapter.conflictEscalation.length).toBeGreaterThan(0);
      expect(chapter.worldCanonDependencies.length).toBeGreaterThan(0);
      expect(chapter.characterMotivationBeats.length).toBeGreaterThan(0);
      expect(chapter.synopsis.length).toBeGreaterThan(0);
      expect(chapter.keyEvents.length).toBeGreaterThan(0);
      expect(chapter.endingHook.length).toBeGreaterThan(0);
      expect(chapter.continuityHooks.length).toBeGreaterThan(0);
      expect(chapter.keyEventsList.length).toBeGreaterThan(0);
    }
  });

  test("rejects outline with empty chapter fields", () => {
    const run = runState("detailed_outline_draft");
    expect(() =>
      compileRichDetailedOutline(EMPTY_CHAPTER_FIELDS_DETAILED, run, detailedOptions),
    ).toThrow("empty Setup/Payoff");
  });

  test("rejects outline with missing required sections", () => {
    const run = runState("detailed_outline_draft");
    expect(() =>
      compileRichDetailedOutline(MISSING_SECTIONS_DETAILED, run, detailedOptions),
    ).toThrow("Rich detailed outline parsing failed");
  });

  test("rejects empty markdown with no chapters", () => {
    const run = runState("detailed_outline_draft");
    const bad = "Not an outline.";
    expect(() =>
      compileRichDetailedOutline(bad, run, detailedOptions),
    ).toThrow("Rich detailed outline parsing failed");
  });

  test("provenance metadata is populated correctly", () => {
    const run = runState("detailed_outline_draft");
    const result = compileRichDetailedOutline(
      FULL_DETAILED_MARKDOWN,
      run,
      {
        sourcePath: "authored/detailed-outline.md",
        templateVersion: "2.0.0",
      },
    );

    expect(result.sourcePath).toBe("authored/detailed-outline.md");
    expect(result.templateVersion).toBe("2.0.0");
    expect(result.markdownHash).toHaveLength(64);
    const compiledDate = new Date(result.compiledAt);
    const now = new Date();
    expect(Math.abs(now.getTime() - compiledDate.getTime())).toBeLessThan(5000);
  });

  test("parses key events into structured list for each chapter", () => {
    const run = runState("detailed_outline_draft");
    const result = compileRichDetailedOutline(
      FULL_DETAILED_MARKDOWN,
      run,
      detailedOptions,
    );

    expect(result.chapters[0].keyEventsList).toEqual([
      "Courier arrives at guild hall and is the only runner present.",
      "Cloaked figure enters, offers a sealed leather case.",
      "Courier takes the job despite warnings.",
      "First whisper from the vow as he steps into the rain.",
    ]);

    expect(result.chapters[1].keyEventsList).toEqual([
      "Departure into the Salt Flats at dawn.",
      "Salt storm forces them to shelter.",
      "Traitor plants the tracking charm.",
      "Salt mirage: courier sees his sister's first fever dream.",
    ]);

    expect(result.chapters[2].keyEventsList).toHaveLength(5);
  });
});
