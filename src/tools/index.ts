import type { ToolDefinition } from "@opencode-ai/plugin"
import { createNovelAcceptCanonTool } from "./novel-accept-canon"
import { createNovelAdvanceStageTool } from "./novel-advance-stage"
import { createNovelArchiveRunTool } from "./novel-archive-run"
import { createNovelCheckBoundariesTool } from "./novel-check-boundaries"
import { createNovelInitProjectTool } from "./novel-init-project"
import { createNovelIngestCorpusTool } from "./novel-ingest-corpus"
import { createNovelProjectStatusTool } from "./novel-project-status"
import { createNovelReadArtifactTool } from "./novel-read-artifact"
import { createNovelRecordReviewTool } from "./novel-record-review"
import { createNovelSelectEvidenceTool } from "./novel-select-evidence"
import { createNovelWriteArtifactTool } from "./novel-write-artifact"

export { createNovelAcceptCanonTool } from "./novel-accept-canon"
export { createNovelAdvanceStageTool } from "./novel-advance-stage"
export { createNovelArchiveRunTool } from "./novel-archive-run"
export { createNovelCheckBoundariesTool } from "./novel-check-boundaries"
export { createNovelInitProjectTool } from "./novel-init-project"
export { createNovelIngestCorpusTool } from "./novel-ingest-corpus"
export { createNovelProjectStatusTool } from "./novel-project-status"
export { createNovelReadArtifactTool } from "./novel-read-artifact"
export { createNovelRecordReviewTool } from "./novel-record-review"
export { createNovelSelectEvidenceTool } from "./novel-select-evidence"
export { createNovelWriteArtifactTool } from "./novel-write-artifact"

export function createAllTools(): Record<string, ToolDefinition> {
  return {
    novel_project_status: createNovelProjectStatusTool(),
    novel_init_project: createNovelInitProjectTool(),
    novel_ingest_corpus: createNovelIngestCorpusTool(),
    novel_read_artifact: createNovelReadArtifactTool(),
    novel_write_artifact: createNovelWriteArtifactTool(),
    novel_advance_stage: createNovelAdvanceStageTool(),
    novel_record_review: createNovelRecordReviewTool(),
    novel_select_evidence: createNovelSelectEvidenceTool(),
    novel_check_boundaries: createNovelCheckBoundariesTool(),
    novel_accept_canon: createNovelAcceptCanonTool(),
    novel_archive_run: createNovelArchiveRunTool(),
  }
}
