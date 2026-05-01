# Novel Cluster

Novel Cluster is an OpenCode plugin for a v1 Chinese web novel MVP workflow. It keeps story development in explicit stages: project setup, idea interview, rough outline, detailed outline, event selection, prose drafting, multi-gate review, explicit canon acceptance, and archive.

## V1 Scope

- Primary Creative Director agent plus specialist subagents for interview, outlining, corpus abstraction, drafting, continuity, prose/style, logic/world/motivation, and preference-boundary review.
- Local `.novel/` project storage for project metadata, current run state, outlines, drafts, reviews, corpus evidence packs, preferences, logs, and accepted canon.
- Deterministic stage gates enforced through tools before prose drafting, draft readiness, and canon acceptance.
- Prose work is scoped to a selected event, scene, bridge, or chapter segment.

## Non-Goals

- No whole-book generation in a single request.
- No vector database or retrieval service.
- No web scraping, remote corpus ingestion, or binary document ingestion.
- No automatic canon mutation from drafts or reviews.
- No human inspection gate hidden outside the stored review and accept-canon workflow.

## Corpus And Copyright Policy

- Corpus ingestion accepts only authorized local `.txt` and `.md` files.
- Ingestion rejects unsupported formats and stores source metadata plus abstract evidence packs, not copied source passages.
- Corpus analysis should extract reusable traits such as pacing, trope tags, scene functions, and style summaries.
- Direct imitation of a named living author must be refused or transformed into abstract, non-infringing traits.

## Usage

1. Install dependencies: `bun install`.
2. Build the plugin: `bun run build`.
3. Configure OpenCode to load the built plugin from `dist/index.js`.
4. Start a project with `/novel-start`.
5. Add authorized local references with `/novel-ingest path/to/file.md`.
6. Continue stage work with `/novel-continue`, and request scoped prose with `/novel-write-event <event>` after the detailed outline is approved.

## Development

- Typecheck: `bun run typecheck`
- Build: `bun run build`
- Test: `bun test`
