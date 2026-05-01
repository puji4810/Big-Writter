import { 
  ParseError, 
  ParseResult, 
  RoughOutline, 
  DetailedOutline, 
  CharacterIndex, 
  CharacterSheet,
  TEMPLATE_VERSION
} from "./types";
import { 
  ROUGH_OUTLINE_SECTIONS, 
  ACT_SUBSECTIONS,
  CHAPTER_SUBSECTIONS,
  CHARACTER_SHEET_SECTIONS
} from "./templates";

function parseSections(markdown: string, level: number = 2): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = markdown.split("\n");
  const headingPrefix = "#".repeat(level) + " ";
  
  let currentSection: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith(headingPrefix)) {
      if (currentSection) {
        sections.set(currentSection, currentContent.join("\n").trim());
      }
      currentSection = line.trim().slice(headingPrefix.length).trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentSection) {
    sections.set(currentSection, currentContent.join("\n").trim());
  }

  return sections;
}

export function parseRoughOutline(markdown: string): ParseResult<RoughOutline> {
  const errors: ParseError[] = [];
  const topSections = parseSections(markdown, 2);
  
  for (const section of ROUGH_OUTLINE_SECTIONS) {
    if (!topSections.has(section)) {
      errors.push({ section, message: `Missing required section: ## ${section}` });
    }
  }

  const actsMarkdown = topSections.get("Acts") || "";
  const actHeadings = actsMarkdown.split("\n").filter(l => l.startsWith("### Act "));
  const acts: RoughOutline["acts"] = [];

  for (const heading of actHeadings) {
    const actTitle = heading.slice(4).trim();
    const actStartIndex = actsMarkdown.indexOf(heading);
    const nextActIndex = actsMarkdown.indexOf("### Act ", actStartIndex + 1);
    const actContent = nextActIndex === -1 
      ? actsMarkdown.slice(actStartIndex) 
      : actsMarkdown.slice(actStartIndex, nextActIndex);
    
    const subSections = parseSections(actContent, 4);
    const actData = {
      title: actTitle,
      goals: subSections.get("Goals") || "",
      stakes: subSections.get("Stakes") || "",
      keyEvents: subSections.get("Key Events") || ""
    };

    for (const sub of ACT_SUBSECTIONS) {
      if (!subSections.has(sub)) {
        errors.push({ section: `Acts -> ${actTitle}`, message: `Missing required subsection: #### ${sub}` });
      }
    }
    acts.push(actData);
  }

  if (topSections.has("Acts") && acts.length === 0) {
    errors.push({ section: "Acts", message: "No acts found. Expected at least one ### Act N: Title" });
  }

  const data: RoughOutline = {
    premiseLogline: topSections.get("Premise/Logline") || "",
    arcIntent: topSections.get("Arc Intent") || "",
    acts,
    coreConflicts: topSections.get("Core Conflicts") || "",
    worldAssumptions: topSections.get("World Assumptions") || "",
    protagonistEmotionalTrajectory: topSections.get("Protagonist Emotional Trajectory") || ""
  };

  return { data: errors.length === 0 ? data : undefined, errors, templateVersion: TEMPLATE_VERSION };
}

export function parseDetailedOutline(markdown: string): ParseResult<DetailedOutline> {
  const errors: ParseError[] = [];
  const lines = markdown.split("\n");
  const chapters: DetailedOutline["chapters"] = [];
  
  const chapterHeadingRegex = /^## Chapter (\d+): (.*)$/;
  const chapterHeadings = lines
    .map((l, index) => ({ line: l, index }))
    .filter(item => chapterHeadingRegex.test(item.line));
  
  for (let i = 0; i < chapterHeadings.length; i++) {
    const { line, index: startIndex } = chapterHeadings[i];
    const match = line.match(chapterHeadingRegex);
    if (!match) continue;
    
    const chapterNumber = parseInt(match[1], 10);
    const title = match[2].trim();
    
    const endIndex = i + 1 < chapterHeadings.length 
      ? chapterHeadings[i + 1].index 
      : lines.length;
    
    const chapterLines = lines.slice(startIndex, endIndex);
    const chapterContent = chapterLines.join("\n");
    
    const subSections = parseSections(chapterContent, 3);
    
    for (const sub of CHAPTER_SUBSECTIONS) {
      if (!subSections.has(sub)) {
        errors.push({ section: `Chapter ${chapterNumber}`, message: `Missing required section: ### ${sub}` });
      }
    }

    chapters.push({
      chapterNumber,
      title,
      goal: subSections.get("Chapter Goal") || "",
      povFocus: subSections.get("POV/Focus") || "",
      setupPayoff: subSections.get("Setup/Payoff") || "",
      conflictEscalation: subSections.get("Conflict Escalation") || "",
      worldCanonDependencies: subSections.get("World/Canon Dependencies") || "",
      characterMotivationBeats: subSections.get("Character Motivation Beats") || "",
      synopsis: subSections.get("Synopsis") || "",
      keyEvents: subSections.get("Key Events") || "",
      endingHook: subSections.get("Ending Hook") || "",
      continuityHooks: subSections.get("Continuity Hooks") || ""
    });
  }

  if (chapters.length === 0) {
    errors.push({ section: "Root", message: "No chapters found. Expected ## Chapter N: Title" });
  }

  return { data: errors.length === 0 ? { chapters } : undefined, errors, templateVersion: TEMPLATE_VERSION };
}

export function parseCharacterIndex(markdown: string): ParseResult<CharacterIndex> {
  const errors: ParseError[] = [];
  const topSections = parseSections(markdown, 2);
  
  if (!topSections.has("Characters")) {
    errors.push({ section: "Characters", message: "Missing required section: ## Characters" });
  }

  const charLines = (topSections.get("Characters") || "").split("\n");
  const characters = charLines
    .map(l => l.trim())
    .filter(l => l.startsWith("- "))
    .map(l => l.slice(2).replace(/^\[\[/, "").replace(/\]\]$/, "").trim());

  return { data: errors.length === 0 ? { characters } : undefined, errors, templateVersion: TEMPLATE_VERSION };
}

export function parseCharacterSheet(markdown: string): ParseResult<CharacterSheet> {
  const errors: ParseError[] = [];
  const topSections = parseSections(markdown, 2);

  for (const section of CHARACTER_SHEET_SECTIONS) {
    if (!topSections.has(section)) {
      errors.push({ section, message: `Missing required section: ## ${section}` });
    }
  }

  const data: CharacterSheet = {
    identity: topSections.get("Identity") || "",
    roleInStory: topSections.get("Role in Story") || "",
    motivation: topSections.get("Motivation") || "",
    arc: topSections.get("Arc") || "",
    keyRelationships: topSections.get("Key Relationships") || "",
    voicePersonality: topSections.get("Voice/Personality") || ""
  };

  return { data: errors.length === 0 ? data : undefined, errors, templateVersion: TEMPLATE_VERSION };
}
