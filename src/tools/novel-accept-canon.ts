import { tool } from "@opencode-ai/plugin"
import { CanonFactSchema, CanonFactSetSchema, DraftArtifactSchema, SCHEMA_VERSION, StageGateInputSchema, computeArtifactHash, type CanonFact, type CanonFactSet } from "../schemas"
import { StageGraph } from "../stage-graph"
import { NovelError, NovelErrorCode } from "../errors"
import { readArtifact, readJsonFile, writeJsonFile } from "../storage"
import { addRunArtifact, artifactPath, isReviewFreshForAcceptedHash, jsonResult, projectRoot, readRunReviews, requireCurrentRun, updateRunStage, writeCurrentRun } from "./common"
import { randomUUID } from "node:crypto"

export function createNovelAcceptCanonTool() {
  return tool({
    description: `Explicitly accept reviewed draft facts into canon.

Use only after the current run is canon_acceptance_pending and reviews for the accepted artifact hash are approved and fresh.
Accepted inputs: explicitAcceptance with action=accept_canon and optional canonFactSet matching CanonFactSetSchema. If canonFactSet is not provided, it will be automatically promoted from the draft factAssumptions.
Outputs: written canon path, accepted canon artifact, and current run advanced to canon_accepted.
Recovery: if blocked, move to canon_acceptance_pending, record fresh approved reviews, or provide explicit accept_canon metadata before retrying.`,
    args: {
      explicitAcceptance: tool.schema.unknown().describe("Explicit acceptance metadata matching StageGateInputSchema.explicitCanonAcceptance."),
      canonFactSet: tool.schema.unknown().optional().describe("Canon fact set matching CanonFactSetSchema. If omitted, will be generated from draft."),
    },
    async execute(args, ctx) {
      const root = projectRoot(ctx)
      const run = await requireCurrentRun(root)
      if (run.stage !== "canon_acceptance_pending") {
        throw new NovelError(NovelErrorCode.STAGE_TRANSITION_BLOCKED, `Canon acceptance requires current stage canon_acceptance_pending, got ${run.stage}`)
      }

      const explicitAcceptance = StageGateInputSchema.shape.explicitCanonAcceptance.unwrap().parse(args.explicitAcceptance)
      const acceptedHash = explicitAcceptance.acceptedArtifactHash

      const reviews = await readRunReviews(run, root)
      const reviewsForAcceptedHash = reviews.filter((review) => isReviewFreshForAcceptedHash(review, acceptedHash))
      if (reviewsForAcceptedHash.length === 0) {
        throw new NovelError(NovelErrorCode.REQUIRED_REVIEW_MISSING, "Canon acceptance requires at least one fresh recorded review for the accepted artifact hash")
      }
      const failingReview = reviewsForAcceptedHash.find((review) => review.status !== "pass")
      if (failingReview) {
        throw new NovelError(NovelErrorCode.STAGE_TRANSITION_BLOCKED, `Review ${failingReview.artifactId} is not passing`)
      }

      let canonFactSet: CanonFactSet
      if (args.canonFactSet) {
        canonFactSet = CanonFactSetSchema.parse(args.canonFactSet)
        if (canonFactSet.acceptedArtifactHash !== acceptedHash) {
          throw new NovelError(NovelErrorCode.REVIEW_ARTIFACT_STALE, "Canon fact set acceptedArtifactHash must match explicit acceptance hash")
        }
      } else {
        const draftArtifact = await findDraftByHash(run, acceptedHash, root)
        if (!draftArtifact) {
          throw new NovelError(NovelErrorCode.ARTIFACT_NOT_FOUND, `No draft found with hash ${acceptedHash} in current run`)
        }
        canonFactSet = {
          schemaVersion: SCHEMA_VERSION,
          artifactId: `canon-fact-set-${randomUUID()}`,
          runId: run.runId,
          createdAt: new Date().toISOString(),
          stage: "canon_accepted",
          status: "accepted",
          sourceArtifactIds: [draftArtifact.artifactId],
          acceptedArtifactHash: acceptedHash,
          facts: draftArtifact.factAssumptions.map((fact, index) => ({
            factId: `fact-${randomUUID()}-${index}`,
            subject: fact.subject,
            predicate: fact.predicate,
            object: fact.object,
            evidenceArtifactIds: [draftArtifact.artifactId],
          })),
        }
      }

      StageGraph.canTransition(run.stage, "canon_accepted", { explicitCanonAcceptance: explicitAcceptance })
      const path = "canon/facts.json"
      const facts = await mergeCanonFacts(path, canonFactSet.facts, root)
      const updatedRun = addRunArtifact(updateRunStage(run, "canon_accepted"), canonFactSet.artifactId)
      await writeCurrentRun(updatedRun, root)
      return jsonResult({
        accepted: true,
        path,
        artifactId: canonFactSet.artifactId,
        factCount: facts.length,
        acceptanceHash: computeArtifactHash(JSON.stringify(explicitAcceptance)),
        currentRun: updatedRun,
      })
    },
  })
}

async function findDraftByHash(run: any, hash: string, root: string) {
  for (const id of run.artifactIds) {
    try {
      const artifact = await readArtifact(artifactPath({ kind: "draft", artifactId: id }), root)
      const draft = DraftArtifactSchema.safeParse(artifact)
      if (draft.success && draft.data.contentHash === hash) {
        return draft.data
      }
    } catch {
      continue
    }
  }
  return null
}

async function mergeCanonFacts(path: string, newFacts: CanonFact[], root: string): Promise<CanonFact[]> {
  const existing = await readJsonFile(path, root)
  const facts = CanonFactSchema.array().parse(existing)
  const existingKeys = new Set(facts.map(factKey))
  for (const fact of newFacts) {
    if (!existingKeys.has(factKey(fact))) {
      facts.push(fact)
      existingKeys.add(factKey(fact))
    }
  }
  await writeJsonFile(path, facts, root)
  return facts
}

function factKey(fact: CanonFact): string {
  return `${fact.subject}\u0000${fact.predicate}\u0000${fact.object}`
}
