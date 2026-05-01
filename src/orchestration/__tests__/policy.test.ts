import { describe, expect, test } from "bun:test"
import { RequiredOutlineReviewGates, RequiredProseReviewGates, type ReviewGateName } from "../../schemas/review"
import type { Stage } from "../../schemas/run"
import { evaluate, orchestrationConstants } from "../policy"
import type { PolicyContext, PolicyInput } from "../types"

function createContext(stage: Stage, overrides: Partial<PolicyContext> = {}): PolicyContext {
  return {
    stage,
    activeArtifacts: {},
    reviewStatus: {},
    input: {
      type: "plain_text",
      textLength: 0,
      fileCount: 0,
    },
    ...overrides,
  }
}

function evaluatePolicy(intent: PolicyInput["intent"], context: PolicyContext) {
  return evaluate({ intent, context })
}

function passingOutlineReviews() {
  return {
    "logic-world-motivation": "pass",
    "continuity": "pass",
    "preference-boundary": "pass",
  } as const satisfies Partial<Record<ReviewGateName, "pass">>
}

function passingProseReviews() {
  return {
    "logic-world-motivation": "pass",
    "prose-style-pacing": "pass",
    "continuity": "pass",
    "preference-boundary": "pass",
  } as const satisfies Partial<Record<ReviewGateName, "pass">>
}

describe("orchestration policy", () => {
  test("outline request at rough_outline_draft dispatches to RoughOutliner", () => {
    const decision = evaluatePolicy({ type: "outline_request" }, createContext("rough_outline_draft"))

    expect(decision.action).toBe("dispatch")
    expect(decision.targetAgent).toBe("rough-outliner")
  })

  test("outline request at detailed_outline_draft dispatches to DetailedOutliner", () => {
    const decision = evaluatePolicy({ type: "outline_request" }, createContext("detailed_outline_draft"))

    expect(decision.action).toBe("dispatch")
    expect(decision.targetAgent).toBe("detailed-outliner")
  })

  test("ingest request with long text triggers the ingest staging pipeline", () => {
    const decision = evaluatePolicy(
      { type: "ingest_request" },
      createContext("interviewing", {
        input: {
          type: "plain_text",
          textLength: orchestrationConstants.LONG_TEXT_INGEST_THRESHOLD,
          fileCount: 0,
        },
      }),
    )

    expect(decision.action).toBe("trigger_ingest")
    expect(decision.targetAgent).toBe("ingest-staging-pipeline")
  })

  test("prose request before detailed outline review approval is blocked", () => {
    const decision = evaluatePolicy({ type: "prose_request" }, createContext("detailed_outline_review"))

    expect(decision.action).toBe("block")
    expect(decision.blockingReason).toContain("Detailed outline approval")
    expect(decision.blocking?.missingReviewGates).toEqual([...RequiredOutlineReviewGates])
  })

  test("prose request after detailed outline approval dispatches to Writer", () => {
    const decision = evaluatePolicy(
      { type: "prose_request" },
      createContext("detailed_outline_review", { reviewStatus: passingOutlineReviews() }),
    )

    expect(decision.action).toBe("dispatch")
    expect(decision.targetAgent).toBe("writer")
  })

  test("review-needed rough outline stage dispatches to reviewers", () => {
    const decision = evaluatePolicy(
      { type: "review_request" },
      createContext("rough_outline_review", {
        reviewStatus: {
          "logic-world-motivation": "pass",
          "continuity": "missing",
          "preference-boundary": "fail",
        },
      }),
    )

    expect(decision.action).toBe("dispatch")
    expect(decision.targetAgent).toBe("reviewers")
    expect(decision.metadata?.missingReviewGates).toEqual(["continuity", "preference-boundary"])
    expect(decision.metadata?.dispatchedAgents).toEqual(["continuity-checker", "preference-boundary-checker"])
  })

  test("simple status request stays in the primary agent", () => {
    const decision = evaluatePolicy({ type: "status_check" }, createContext("prose_draft"))

    expect(decision.action).toBe("stay")
    expect(decision.targetAgent).toBe("creative-director")
  })

  test("corpus analysis request dispatches to CorpusAnalyst", () => {
    const decision = evaluatePolicy({ type: "corpus_analysis" }, createContext("event_selection"))

    expect(decision.action).toBe("dispatch")
    expect(decision.targetAgent).toBe("corpus-analyst")
  })

  test("ingest completion triggers follow-up corpus analysis", () => {
    const decision = evaluatePolicy({ type: "ingest_completion" }, createContext("prose_draft"))

    expect(decision.action).toBe("dispatch")
    expect(decision.targetAgent).toBe("corpus-analyst")
    expect(decision.reason).toContain("corpus analysis")
  })

  test("markdown prose requests compile active authored markdown before dispatch", () => {
    const decision = evaluatePolicy(
      { type: "prose_request" },
      createContext("event_selection", {
        activeArtifacts: {
          prose: [{ id: "draft-1", kind: "prose", format: "markdown" }],
        },
        reviewStatus: passingProseReviews(),
        input: {
          type: "markdown",
          textLength: 800,
          fileCount: 0,
        },
      }),
    )

    expect(decision.action).toBe("trigger_compile")
    expect(decision.targetAgent).toBe("markdown-compiler")
  })
})
