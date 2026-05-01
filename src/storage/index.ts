import { existsSync } from "node:fs"
import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, isAbsolute, relative, resolve, sep } from "node:path"
import { randomUUID } from "node:crypto"
import { z } from "zod"
import { NovelError, NovelErrorCode } from "../errors"
import {
  CanonFactSetSchema,
  CorpusSourceSchema,
  DetailedOutlineArtifactSchema,
  DraftArtifactSchema,
  EvidencePackSchema,
  InterviewArtifactSchema,
  NovelProjectSchema,
  PreferenceBoundaryProfileSchema,
  ReviewResultSchema,
  RoughOutlineArtifactSchema,
  RunStateSchema,
  SCHEMA_VERSION,
  type NovelProject,
} from "../schemas"

const REQUIRED_DIRECTORIES = [
  "canon",
  "corpus/evidence-packs",
  "corpus/sources",
  "outlines/rough",
  "outlines/detailed",
  "runs",
  "drafts",
  "logs",
] as const

const REQUIRED_FILES = {
  "preferences.md": "# Preferences\n\n",
  "canon/facts.json": "[]\n",
  "canon/characters.json": "[]\n",
  "canon/world.json": "{}\n",
  "canon/timeline.json": "[]\n",
  "canon/style.md": "# Canon Style\n\n",
  "logs/decisions.md": "# Decisions\n\n",
} as const

const artifactSchemas = [
  NovelProjectSchema,
  RunStateSchema,
  CorpusSourceSchema,
  EvidencePackSchema,
  CanonFactSetSchema,
  InterviewArtifactSchema,
  RoughOutlineArtifactSchema,
  DetailedOutlineArtifactSchema,
  DraftArtifactSchema,
  ReviewResultSchema,
  PreferenceBoundaryProfileSchema,
] as const satisfies readonly z.ZodType[]

export type NovelArtifact = z.infer<(typeof artifactSchemas)[number]>

export async function initNovelProject(projectRoot: string): Promise<NovelProject> {
  const novelRoot = resolve(projectRoot, ".novel")
  await mkdir(novelRoot, { recursive: true })

  await Promise.all(REQUIRED_DIRECTORIES.map((directory) => mkdir(resolveNovelPath(directory, projectRoot), { recursive: true })))
  await Promise.all(Object.entries(REQUIRED_FILES).map(([filePath, contents]) => createFileIfMissing(filePath, contents, projectRoot)))

  const projectPath = resolveNovelPath("project.json", projectRoot)
  if (existsSync(projectPath)) {
    const project = await readArtifact("project.json", projectRoot)
    const result = NovelProjectSchema.safeParse(project)
    if (!result.success) {
      throw new NovelError(NovelErrorCode.ARTIFACT_CORRUPT, `Artifact ${projectPath} does not match NovelProject schema`)
    }

    return result.data
  }

  const now = new Date().toISOString()
  const project = NovelProjectSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    projectId: randomUUID(),
    title: "Untitled Novel",
    premise: "TBD",
    targetAudience: "TBD",
    storyObjective: "TBD",
    createdAt: now,
    updatedAt: now,
  })

  await writeArtifact("project.json", project, projectRoot)
  return project
}

export function resolveNovelPath(subpath: string, projectRoot: string): string {
  if (isAbsolute(subpath)) {
    throwPathError(subpath, projectRoot)
  }

  const novelRoot = resolve(projectRoot, ".novel")
  const sanitizedSubpath = subpath === ".novel" || subpath.startsWith(`.novel${sep}`) || subpath.startsWith(".novel/")
    ? subpath.slice(".novel".length).replace(/^[/\\]+/, "")
    : subpath
  const resolvedPath = resolve(novelRoot, sanitizedSubpath)
  const relativePath = relative(novelRoot, resolvedPath)

  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return resolvedPath
  }

  throwPathError(subpath, projectRoot)
}

export async function readJsonFile(path: string, projectRoot: string): Promise<unknown> {
  if (!projectExists(projectRoot)) {
    throw new NovelError(NovelErrorCode.PROJECT_NOT_INITIALIZED, `Novel project is not initialized at ${resolve(projectRoot, ".novel")}`)
  }

  const artifactPath = resolveNovelPath(path, projectRoot)
  let contents: string
  try {
    contents = await readFile(artifactPath, "utf8")
  } catch (error) {
    throw new NovelError(NovelErrorCode.ARTIFACT_CORRUPT, `Unable to read artifact ${artifactPath}: ${formatCause(error)}`)
  }

  try {
    return JSON.parse(contents)
  } catch (error) {
    throw new NovelError(NovelErrorCode.ARTIFACT_CORRUPT, `Artifact ${artifactPath} contains invalid JSON: ${formatCause(error)}`)
  }
}

export async function writeJsonFile(path: string, data: unknown, projectRoot: string): Promise<void> {
  if (!projectExists(projectRoot)) {
    throw new NovelError(NovelErrorCode.PROJECT_NOT_INITIALIZED, `Novel project is not initialized at ${resolve(projectRoot, ".novel")}`)
  }

  const artifactPath = resolveNovelPath(path, projectRoot)
  const tempPath = `${artifactPath}.${randomUUID()}.tmp`
  await mkdir(dirname(artifactPath), { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8")
  await rename(tempPath, artifactPath)
}

export async function readArtifact(path: string, projectRoot: string): Promise<NovelArtifact> {
  if (!projectExists(projectRoot)) {
    throw new NovelError(NovelErrorCode.PROJECT_NOT_INITIALIZED, `Novel project is not initialized at ${resolve(projectRoot, ".novel")}`)
  }

  const artifactPath = resolveNovelPath(path, projectRoot)
  const parsed = await readJsonFile(path, projectRoot)

  for (const schema of artifactSchemas) {
    const result = schema.safeParse(parsed)
    if (result.success) {
      return result.data as NovelArtifact
    }
  }

  throw new NovelError(NovelErrorCode.ARTIFACT_CORRUPT, `Artifact ${artifactPath} does not match a supported schema`)
}

export async function writeArtifact(path: string, data: unknown, projectRoot: string): Promise<void> {
  if (!projectExists(projectRoot) && normalizeNovelSubpath(path) !== "project.json") {
    throw new NovelError(NovelErrorCode.PROJECT_NOT_INITIALIZED, `Novel project is not initialized at ${resolve(projectRoot, ".novel")}`)
  }

  const artifactPath = resolveNovelPath(path, projectRoot)
  const artifact = validateArtifact(data, artifactPath)
  const tempPath = `${artifactPath}.${randomUUID()}.tmp`

  await mkdir(dirname(artifactPath), { recursive: true })
  await writeFile(tempPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
  await rename(tempPath, artifactPath)
}

export function projectExists(projectRoot: string): boolean {
  return existsSync(resolve(projectRoot, ".novel", "project.json"))
}

async function createFileIfMissing(path: string, contents: string, projectRoot: string): Promise<void> {
  const targetPath = resolveNovelPath(path, projectRoot)
  if (!existsSync(targetPath)) {
    await writeFile(targetPath, contents, "utf8")
  }
}

function validateArtifact(data: unknown, artifactPath: string): NovelArtifact {
  for (const schema of artifactSchemas) {
    const result = schema.safeParse(data)
    if (result.success) {
      return result.data as NovelArtifact
    }
  }

  throw new NovelError(NovelErrorCode.ARTIFACT_CORRUPT, `Artifact ${artifactPath} does not match a supported schema`)
}

function normalizeNovelSubpath(path: string): string {
  return path.replace(/^\.novel[/\\]+/, "")
}

function throwPathError(subpath: string, projectRoot: string): never {
  throw new NovelError(
    NovelErrorCode.PATH_OUTSIDE_NOVEL_ROOT,
    `Path ${subpath} resolves outside novel root ${resolve(projectRoot, ".novel")}`
  )
}

function formatCause(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
