import { parseRoughOutline, parseDetailedOutline } from "../authoring/parser";
import { TEMPLATE_VERSION } from "../authoring/types";
import { buildProvenanceMeta } from "../orchestration/provenance";
import type { RunState } from "../schemas";

function parseKeyEventsList(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.replace(/^-\s*/, "").trim())
    .filter(Boolean);
}

export interface CompileRichOptions {
  sourcePath: string;
  templateVersion?: string;
}

export interface RichRoughAct {
  title: string;
  goals: string;
  stakes: string;
  keyEvents: string;
  keyEventsList: string[];
}

export interface RichRoughOutlineResult {
  sourcePath: string;
  markdownHash: string;
  templateVersion: string;
  compiledAt: string;

  premiseLogline: string;
  arcIntent: string;
  acts: RichRoughAct[];
  coreConflicts: string;
  worldAssumptions: string;
  protagonistEmotionalTrajectory: string;
}

export interface RichDetailedChapter {
  chapterNumber: number;
  title: string;
  goal: string;
  povFocus: string;
  setupPayoff: string;
  conflictEscalation: string;
  worldCanonDependencies: string;
  characterMotivationBeats: string;
  synopsis: string;
  keyEvents: string;
  keyEventsList: string[];
  endingHook: string;
  continuityHooks: string;
}

export interface RichDetailedOutlineResult {
  sourcePath: string;
  markdownHash: string;
  templateVersion: string;
  compiledAt: string;

  chapters: RichDetailedChapter[];
}

const MIN_ACTS = 2;

export function compileRichRoughOutline(
  markdown: string,
  run: RunState,
  options: CompileRichOptions,
): RichRoughOutlineResult {
  const parseResult = parseRoughOutline(markdown);
  if (!parseResult.data) {
    const errMsgs = parseResult.errors
      .map((e) => `  [${e.section}] ${e.message}`)
      .join("\n");
    throw new Error(
      `Rich rough outline parsing failed:\n${errMsgs}`,
    );
  }

  const data = parseResult.data;
  const errors: string[] = [];

  if (data.acts.length < MIN_ACTS) {
    errors.push(
      `Only ${data.acts.length} act(s) found. Rich rough outlines require at least ${MIN_ACTS} acts.`,
    );
  }

  for (const act of data.acts) {
    if (!act.goals.trim()) {
      errors.push(`Act "${act.title}" has empty goals`);
    }
    if (!act.stakes.trim()) {
      errors.push(`Act "${act.title}" has empty stakes`);
    }
    if (!act.keyEvents.trim()) {
      errors.push(`Act "${act.title}" has empty key events`);
    }
  }

  if (!data.premiseLogline.trim()) {
    errors.push("Premise/Logline is empty");
  }
  if (!data.arcIntent.trim()) {
    errors.push("Arc Intent is empty");
  }
  if (!data.coreConflicts.trim()) {
    errors.push("Core Conflicts is empty");
  }
  if (!data.worldAssumptions.trim()) {
    errors.push("World Assumptions is empty");
  }
  if (!data.protagonistEmotionalTrajectory.trim()) {
    errors.push("Protagonist Emotional Trajectory is empty");
  }

  if (errors.length > 0) {
    throw new Error(
      `Rich rough outline compilation rejected — thin outline detected:\n${errors
        .map((e) => `  \u2022 ${e}`)
        .join("\n")}`,
    );
  }

  const tv = options.templateVersion ?? parseResult.templateVersion;
  const provenance = buildProvenanceMeta({
    sourcePath: options.sourcePath,
    markdownContent: markdown,
    templateVersion: tv,
  });

  return {
    sourcePath: provenance.sourcePath,
    markdownHash: provenance.markdownHash,
    templateVersion: provenance.templateVersion,
    compiledAt: provenance.compiledAt,

    premiseLogline: data.premiseLogline,
    arcIntent: data.arcIntent,
    acts: data.acts.map((act) => ({
      title: act.title,
      goals: act.goals,
      stakes: act.stakes,
      keyEvents: act.keyEvents,
      keyEventsList: parseKeyEventsList(act.keyEvents),
    })),
    coreConflicts: data.coreConflicts,
    worldAssumptions: data.worldAssumptions,
    protagonistEmotionalTrajectory: data.protagonistEmotionalTrajectory,
  };
}

export function compileRichDetailedOutline(
  markdown: string,
  run: RunState,
  options: CompileRichOptions,
): RichDetailedOutlineResult {
  const parseResult = parseDetailedOutline(markdown);
  if (!parseResult.data) {
    const errMsgs = parseResult.errors
      .map((e) => `  [${e.section}] ${e.message}`)
      .join("\n");
    throw new Error(
      `Rich detailed outline parsing failed:\n${errMsgs}`,
    );
  }

  const data = parseResult.data;
  const errors: string[] = [];

  if (data.chapters.length === 0) {
    errors.push(
      "No chapters found. Rich detailed outlines require at least one chapter.",
    );
  }

  for (const chapter of data.chapters) {
    if (!chapter.goal.trim()) {
      errors.push(
        `Chapter ${chapter.chapterNumber} "${chapter.title}" has empty Chapter Goal`,
      );
    }
    if (!chapter.povFocus.trim()) {
      errors.push(
        `Chapter ${chapter.chapterNumber} "${chapter.title}" has empty POV/Focus`,
      );
    }
    if (!chapter.setupPayoff.trim()) {
      errors.push(
        `Chapter ${chapter.chapterNumber} "${chapter.title}" has empty Setup/Payoff`,
      );
    }
    if (!chapter.conflictEscalation.trim()) {
      errors.push(
        `Chapter ${chapter.chapterNumber} "${chapter.title}" has empty Conflict Escalation`,
      );
    }
    if (!chapter.worldCanonDependencies.trim()) {
      errors.push(
        `Chapter ${chapter.chapterNumber} "${chapter.title}" has empty World/Canon Dependencies`,
      );
    }
    if (!chapter.characterMotivationBeats.trim()) {
      errors.push(
        `Chapter ${chapter.chapterNumber} "${chapter.title}" has empty Character Motivation Beats`,
      );
    }
    if (!chapter.synopsis.trim()) {
      errors.push(
        `Chapter ${chapter.chapterNumber} "${chapter.title}" has empty Synopsis`,
      );
    }
    if (!chapter.keyEvents.trim()) {
      errors.push(
        `Chapter ${chapter.chapterNumber} "${chapter.title}" has empty Key Events`,
      );
    }
    if (!chapter.endingHook.trim()) {
      errors.push(
        `Chapter ${chapter.chapterNumber} "${chapter.title}" has empty Ending Hook`,
      );
    }
    if (!chapter.continuityHooks.trim()) {
      errors.push(
        `Chapter ${chapter.chapterNumber} "${chapter.title}" has empty Continuity Hooks`,
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Rich detailed outline compilation rejected — thin outline detected:\n${errors
        .map((e) => `  \u2022 ${e}`)
        .join("\n")}`,
    );
  }

  const tv = options.templateVersion ?? parseResult.templateVersion;
  const provenance = buildProvenanceMeta({
    sourcePath: options.sourcePath,
    markdownContent: markdown,
    templateVersion: tv,
  });

  return {
    sourcePath: provenance.sourcePath,
    markdownHash: provenance.markdownHash,
    templateVersion: provenance.templateVersion,
    compiledAt: provenance.compiledAt,

    chapters: data.chapters.map((chapter) => ({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      goal: chapter.goal,
      povFocus: chapter.povFocus,
      setupPayoff: chapter.setupPayoff,
      conflictEscalation: chapter.conflictEscalation,
      worldCanonDependencies: chapter.worldCanonDependencies,
      characterMotivationBeats: chapter.characterMotivationBeats,
      synopsis: chapter.synopsis,
      keyEvents: chapter.keyEvents,
      keyEventsList: parseKeyEventsList(chapter.keyEvents),
      endingHook: chapter.endingHook,
      continuityHooks: chapter.continuityHooks,
    })),
  };
}
