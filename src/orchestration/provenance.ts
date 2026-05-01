import { readFile } from "node:fs/promises"
import { resolveNovelPath, readArtifact } from "../storage"
import { computeArtifactHash } from "../schemas/review"
import type { RunState, RoughOutlineArtifact, DetailedOutlineArtifact, ProvenanceMeta } from "../schemas"
import { artifactPath } from "../tools/common"

export function computeMarkdownHash(markdown: string): string {
  return computeArtifactHash(markdown)
}

export async function resolveActiveRoughOutline(
  run: RunState,
  root: string,
): Promise<RoughOutlineArtifact | null> {
  const pointer = run.activeRoughOutline
  if (!pointer) return null

  try {
    const artifact = await readArtifact(
      artifactPath({ kind: "rough_outline", artifactId: pointer.artifactId }),
      root,
    )
    return artifact as RoughOutlineArtifact
  } catch {
    return null
  }
}

export async function resolveActiveDetailedOutline(
  run: RunState,
  root: string,
): Promise<DetailedOutlineArtifact | null> {
  const pointer = run.activeDetailedOutline
  if (!pointer) return null

  try {
    const artifact = await readArtifact(
      artifactPath({ kind: "detailed_outline", artifactId: pointer.artifactId }),
      root,
    )
    return artifact as DetailedOutlineArtifact
  } catch {
    return null
  }
}

export type MarkdownKind = "rough_outline" | "detailed_outline"

export async function isMarkdownStale(
  run: RunState,
  kind: MarkdownKind,
  projectRoot: string,
): Promise<boolean> {
  const pointer = kind === "rough_outline" ? run.activeRoughOutline : run.activeDetailedOutline
  if (!pointer) return false

  try {
    const resolvedPath = resolveNovelPath(pointer.markdownPath, projectRoot)
    const content = await readFile(resolvedPath, "utf8")
    const onDiskHash = computeMarkdownHash(content)
    return onDiskHash !== pointer.markdownHash
  } catch {
    return true
  }
}

export function buildProvenanceMeta(options: {
  sourcePath: string
  markdownContent: string
  templateVersion: string
}): ProvenanceMeta {
  return {
    sourcePath: options.sourcePath,
    markdownHash: computeMarkdownHash(options.markdownContent),
    templateVersion: options.templateVersion,
    compiledAt: new Date().toISOString(),
  }
}
