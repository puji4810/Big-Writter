import { describe, expect, test } from "bun:test"
import {
  WRITABLE_ARTIFACT_KINDS,
  RUN_ARTIFACT_BASE_FIELDS,
  INTERVIEW_ADVANCEMENT_GATE_GUIDANCE,
  buildArtifactPayloadGuidance,
} from "../artifact-guidance"
import { ArtifactReferenceSchema } from "../../tools/common"

describe("artifact guidance", () => {
  test("WRITABLE_ARTIFACT_KINDS contains all 8 kinds exactly", () => {
    expect(WRITABLE_ARTIFACT_KINDS).toEqual([
      "interview",
      "rough_outline",
      "detailed_outline",
      "draft",
      "review",
      "evidence_pack",
      "canon_fact_set",
      "boundary_profile",
    ])
  })

  test("RUN_ARTIFACT_BASE_FIELDS names all 7 base field keys", () => {
    const keys = Object.keys(RUN_ARTIFACT_BASE_FIELDS)
    expect(keys).toEqual([
      "schemaVersion",
      "artifactId",
      "runId",
      "createdAt",
      "stage",
      "sourceArtifactIds",
      "status",
    ])
  })

  test("buildArtifactPayloadGuidance() includes all 8 writable kinds by name", () => {
    const guidance = buildArtifactPayloadGuidance()
    const requiredKinds = [
      "interview",
      "rough_outline",
      "detailed_outline",
      "draft",
      "review",
      "evidence_pack",
      "canon_fact_set",
      "boundary_profile",
    ]
    for (const kind of requiredKinds) {
      expect(guidance).toContain(kind)
    }
  })

  test("buildArtifactPayloadGuidance() includes strict/no-extra-keys warning", () => {
    const guidance = buildArtifactPayloadGuidance()
    const hasWarning =
      guidance.includes("strict") ||
      guidance.includes("no extra") ||
      guidance.includes("no additional") ||
      guidance.includes("no unknown")
    expect(hasWarning).toBe(true)
  })

  test("buildArtifactPayloadGuidance() includes Interview legacy key warnings", () => {
    const guidance = buildArtifactPayloadGuidance()
    expect(guidance).toContain("premise")
    expect(guidance).toContain("genre")
    expect(guidance).toContain("tone")
    expect(guidance).toContain("hardBoundaries")
  })

  test("buildArtifactPayloadGuidance() includes base field names", () => {
    const guidance = buildArtifactPayloadGuidance()
    const fields = [
      "schemaVersion",
      "artifactId",
      "runId",
      "createdAt",
      "stage",
      "sourceArtifactIds",
      "status",
    ]
    for (const field of fields) {
      expect(guidance).toContain(field)
    }
  })

  test("buildArtifactPayloadGuidance() distinguishes selector from payload", () => {
    const guidance = buildArtifactPayloadGuidance()
    expect(guidance).toContain("selector")
    expect(guidance).toContain("payload")
  })

  test("buildArtifactPayloadGuidance() mentions boundary_profile uses profileId not artifactId", () => {
    const guidance = buildArtifactPayloadGuidance()
    expect(guidance).toContain("profileId")
    expect(guidance).toContain("NOT artifactId")
  })

  test("INTERVIEW_ADVANCEMENT_GATE_GUIDANCE names all three gates", () => {
    expect(INTERVIEW_ADVANCEMENT_GATE_GUIDANCE).toContain("hasInterviewArtifact")
    expect(INTERVIEW_ADVANCEMENT_GATE_GUIDANCE).toContain("hasTargetAudience")
    expect(INTERVIEW_ADVANCEMENT_GATE_GUIDANCE).toContain("hasStoryObjective")
  })

  test("buildArtifactPayloadGuidance() returns a non-empty string", () => {
    const guidance = buildArtifactPayloadGuidance()
    expect(guidance.length).toBeGreaterThan(0)
  })

  test("WRITABLE_ARTIFACT_KINDS matches ArtifactReferenceSchema writable kinds (drift guard)", () => {
    const readOnlyKinds = new Set(["project", "current_run"])
    const refKinds = ArtifactReferenceSchema.options as Array<{ shape: { kind: { value: string } } }>
    const writableFromSchema = refKinds
      .map((opt: { shape: { kind: { value: string } } }) => opt.shape.kind.value)
      .filter((k: string) => !readOnlyKinds.has(k))
      .sort()
    const guidanceKinds = [...WRITABLE_ARTIFACT_KINDS].sort()
    expect(guidanceKinds.join(",")).toBe(writableFromSchema.join(","))
  })
})
