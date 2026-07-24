# Notebook RAG Console

A NotebookLM-style document-research console in a single Next.js app: create a **notebook** (per-notebook LanceDB vector table), upload documents, and ask grounded, streaming, citation-rich questions — powered by **Amazon Bedrock** (Titan/Cohere embeddings, Claude generation) with **no external servers**.

The core feature is the **chunking Strategy system**: chunking behavior (`fixed_size`, `recursive`, `delimiter`, `pdf_one_per_page`) is selectable per document, each strategy self-describes its config schema (drives the UI *and* server validation), and chunk provenance (page, char offsets) flows into citations. **Adding a strategy = one class + one registry entry — nothing else changes** (proven; see `VERIFICATION.md`).

See `SPEC.md` (what), `CLAUDE.md` (how/process), `VERIFICATION.md` (verified environment facts + acceptance results).

## Setup

```bash
npm install
cp .env.local.example .env.local   # set AWS_REGION / AWS_PROFILE (SSO: aws sso login first)
npm run dev                        # → http://localhost:3000
```

Requirements: Node 22+, AWS credentials with Bedrock model access in your region for:
- `amazon.titan-embed-text-v2:0` (embeddings; 256/512/1024 dims)
- `cohere.embed-english-v3` (optional second embedding model)
- `us.anthropic.claude-sonnet-4-5-20250929-v1:0` / `us.anthropic.claude-haiku-4-5-20251001-v1:0` (generation — **inference-profile IDs**; bare `anthropic.…` IDs are rejected for these models)

The app boots and serves `/api/strategies` + `/api/models` without AWS credentials; only ingestion/query need Bedrock. Data lives under `./data` (gitignored): JSON metadata + per-notebook LanceDB tables + uploads. Delete is explicit and removes everything.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run lint` | ESLint incl. **layering boundary rules** (routes/services/facade/components import restrictions) |
| `npx vitest run` | Unit tests: strategies, config compilation, loaders, repositories/concurrency |
| `npx tsx scripts/verify-lancedb.mts` | Probe LanceDB capabilities on this machine |
| `npx tsx scripts/verify-bedrock.mts` | Probe Bedrock models/dims/streaming in this account (**run before trusting the registry**) |
| `npx tsx scripts/verify-loaders.mts` | Probe pdfjs per-page extraction + encoding fallback |
| `npx tsx scripts/smoke.mts [base]` | API end-to-end smoke (server must be running) |
| `npx tsx scripts/defensive-matrix.mts [base]` | Hostile-file matrix through the API |
| `npx tsx scripts/ui-smoke.mts [base]` | Headless-browser UI walkthrough (screenshots → `.verify/ui/`) |

## Architecture (short version)

```
routes (zod + auth + one facade call + SSE)
  → NotebookFacade (use-case orchestration)
    → services (NotebookService · IngestionService · ChunkingService · EmbeddingService · QueryService · JobService)
      → repository/adapter interfaces
        → file repos (atomic JSON writes + per-file locks) · LanceDBVectorStore · Bedrock adapters · LocalDiskUploader · StubAuthProvider
```

- Layering is **enforced by ESLint** — a route importing a repository is a build failure.
- All entities/paths are user-scoped (`data/users/{userId}/…`); the `AuthProvider` stub (`local-user`) is the only place the user is resolved.
- Ingestion runs as in-process background jobs (parse → chunk → embed → store); a bad file fails only its own document, with a readable reason.
- Registries (chunking strategies, Bedrock models) are typed data; factories resolve ids — no `if (strategy === …)` / `if (modelId === …)` at call sites.

## Adding a chunking strategy

1. Create `lib/chunking/strategies/your-strategy.ts` implementing `ChunkingStrategy` (id, applicability, `configSchema()`, pure `chunk()`).
2. Add one instance to `CHUNKING_STRATEGIES` in `lib/chunking/registry.ts` (+ optionally one line in `DEFAULT_STRATEGY_BY_TYPE`).

That's it — `/api/strategies`, the upload UI's config controls, server-side zod validation, and stored provenance all derive from the interface.

## Adding a model

Add one entry to `EMBEDDING_MODELS` or `LLM_MODELS` in `lib/models/registry.ts` — but **verify first** with `scripts/verify-bedrock.mts` (real dim, invocability, schema). Never guess model IDs or dims; see CLAUDE.md §0.
