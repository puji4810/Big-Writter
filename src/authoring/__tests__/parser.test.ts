import { describe, expect, it } from "bun:test";
import { 
  parseRoughOutline, 
  parseDetailedOutline, 
  parseCharacterIndex, 
  parseCharacterSheet 
} from "../parser";
import { 
  ROUGH_OUTLINE_TEMPLATE, 
  DETAILED_OUTLINE_TEMPLATE, 
  CHARACTER_INDEX_TEMPLATE, 
  CHARACTER_SHEET_TEMPLATE 
} from "../templates";

describe("Authoring Parsers", () => {
  describe("parseRoughOutline", () => {
    it("should parse a valid rough outline template", () => {
      const result = parseRoughOutline(ROUGH_OUTLINE_TEMPLATE);
      expect(result.errors).toHaveLength(0);
      expect(result.data).toBeDefined();
      expect(result.data?.acts).toHaveLength(1);
      expect(result.data?.acts[0].title).toBe("Act 1: [Title]");
    });

    it("should reject rough outline with missing sections", () => {
      const invalidMd = "## Premise/Logline\nSome premise";
      const result = parseRoughOutline(invalidMd);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.section === "Arc Intent")).toBe(true);
      expect(result.data).toBeUndefined();
    });

    it("should reject rough outline with missing act subsections", () => {
      const invalidMd = ROUGH_OUTLINE_TEMPLATE.replace("#### Goals", "#### WrongHeading");
      const result = parseRoughOutline(invalidMd);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.message.includes("Missing required subsection: #### Goals"))).toBe(true);
    });
  });

  describe("parseDetailedOutline", () => {
    it("should parse a valid detailed outline template", () => {
      const result = parseDetailedOutline(DETAILED_OUTLINE_TEMPLATE);
      expect(result.errors).toHaveLength(0);
      expect(result.data).toBeDefined();
      expect(result.data?.chapters).toHaveLength(1);
      expect(result.data?.chapters[0].title).toBe("[Chapter Title]");
    });

    it("should reject detailed outline with missing chapter sections", () => {
      const invalidMd = "## Chapter 1: Title\n### Chapter Goal\nGoal";
      const result = parseDetailedOutline(invalidMd);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.section === "Chapter 1" && e.message.includes("POV/Focus"))).toBe(true);
    });
  });

  describe("parseCharacterIndex", () => {
    it("should parse a valid character index template", () => {
      const result = parseCharacterIndex(CHARACTER_INDEX_TEMPLATE);
      expect(result.errors).toHaveLength(0);
      expect(result.data?.characters).toContain("Character Name");
    });
  });

  describe("parseCharacterSheet", () => {
    it("should parse a valid character sheet template", () => {
      const result = parseCharacterSheet(CHARACTER_SHEET_TEMPLATE);
      expect(result.errors).toHaveLength(0);
      expect(result.data?.identity).toBeDefined();
    });
  });
});
