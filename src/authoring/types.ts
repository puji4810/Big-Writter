export interface ParseError {
  section: string;
  message: string;
  line?: number;
}

export interface ParseResult<T> {
  data?: T;
  errors: ParseError[];
  templateVersion: string;
}

export interface RoughOutline {
  premiseLogline: string;
  arcIntent: string;
  acts: {
    title: string;
    goals: string;
    stakes: string;
    keyEvents: string;
  }[];
  coreConflicts: string;
  worldAssumptions: string;
  protagonistEmotionalTrajectory: string;
}

export interface DetailedOutline {
  chapters: {
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
    endingHook: string;
    continuityHooks: string;
  }[];
}

export interface CharacterIndex {
  characters: string[];
}

export interface CharacterSheet {
  identity: string;
  roleInStory: string;
  motivation: string;
  arc: string;
  keyRelationships: string;
  voicePersonality: string;
}

export const AUTHORED_DIR = "authored";
export const ROUGH_OUTLINE_PATH = "authored/rough-outline.md";
export const DETAILED_OUTLINE_PATH = "authored/detailed-outline.md";
export const CHARACTER_INDEX_PATH = "authored/characters/index.md";
export const CHARACTER_SHEETS_DIR = "authored/characters";

export const TEMPLATE_VERSION = "1.0.0";
