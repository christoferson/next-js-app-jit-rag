# SPEC.md — Notebook RAG Console (All-TypeScript, LanceDB + Bedrock)

## 1. Overview

A single **Next.js (TypeScript)** application — a document-research console in the spirit of NotebookLM, built on **well-maintained OSS primitives** rather than a hosted RAG service. A user creates a **notebook** (a provisioned-on-the-fly vector collection), uploads documents into it, and queries/analyzes them with a grounded, streaming, citation-rich chat. Notebooks are **persistent** (file-backed) and deleted only explicitly.

The application's **core value and differentiator is its chunking system**: a **Strategy pattern** where chunking behavior (fixed-size, recursive, delimiter, and later per-page/per-row) is selectable per document — either chosen by the user or defaulted by file type — with each strategy exposing a self-describing config schema that drives the UI, server validation, and stored provenance. Chunk provenance (page, offset, etc.) flows into citations so answers cite meaningful locations, not opaque chunk numbers.

Everything runs in **one process** with **no external servers**: metadata lives in **file-based repositories** (JSON, atomic writes), vectors live in **per-notebook LanceDB tables on local disk**, embeddings come from **Amazon Bedrock**. Setup is two commands: `npm install`, `npm run dev`.

The system is **multi-user by design, single-node by runtime**: every entity and storage path is keyed by `userId`, but auth is a stub (`local-user`) behind an `AuthProvider` seam. Swapping file→Postgres, local→S3, LanceDB→OpenSearch, or stub→Cognito are **implementation swaps behind interfaces**, never rewrites.

Five architectural mandates:

1. **Layered by Facade → Service → Repository.** Route handlers are thin (validate + delegate + stream). Facades orchestrate use-cases. Services hold business logic. Repositories abstract storage. No layer reaches past its neighbor.
2. **Chunking is a first-class Strategy Registry.** Adding a chunking strategy = one class + one registry entry. **No `if (strategy === …)` at call sites.** Same for the Bedrock model registry.
3. **Storage behind interfaces (Repository/Adapter).** File-based repos + LanceDB + local uploader + stub auth today; Postgres/OpenSearch/S3/Cognito later — **same interfaces**.
4. **Defensive ingestion.** Files are heterogeneous/hostile (corrupt PDFs, empty docs, bad encodings, oversize). A bad file fails **per-document** with a readable reason inside an async job; it never crashes the server or a sibling document.
5. **Ideal, stylish UI.** Dark-first console aesthetic, notebook workspace, live ingestion progress, animated streaming answers with expandable inline citations, keyboard-friendly. UI quality is first-class (§7).

Region via `AWS_REGION`; credentials via local `AWS_PROFILE` (SSO supported). Bedrock clients are **server-only** — never in the client bundle.

## 2. Goals & Non-Goals

### Goals

- **Notebook lifecycle**: create (name + embedding model → fixes vector dimension), list, open, **explicit delete** (removes metadata + LanceDB table + uploads). Notebooks persist indefinitely; no idle eviction.
- **Document upload & async ingestion**: 1..N files per notebook; each file becomes an **ingestion job** (parse → chunk → embed → store) run as an **in-process background task** with streamed/polled progress and per-document status.
- **Chunking strategy system (the centerpiece)**:
  - A registry of strategies, each `applicable_to(fileType)` with a self-describing `configSchema`.
  - **Two selection modes**: user picks a strategy (+ config) per document, OR the system applies a **default strategy per file type**.
  - v1 strategies: `fixed_size`, `recursive`, `delimiter`, `pdf_one_per_page`.
  - Chunks carry rich **provenance** (`page`, `charStart/charEnd`, ordinal, custom metadata) → surfaced in citations.
  - Strategy + config is recorded **per document** (a notebook can mix strategies across its documents).
- **Grounded streaming query**: embed query → vector search in the notebook's LanceDB table (top-k + optional score threshold, optional metadata filter) → build grounded prompt → stream answer token-by-token → emit **citations** (document, page/location, snippet, similarity score) rendered as expandable inline markers `[1]…[k]`.
- **Bedrock provider registry**: embedding models (Titan Text V2 etc.) modeled as typed metadata that fixes index dimensionality and gates behavior. Generation LLM likewise. **Adding a model = one registry entry.**
- **Document management within a notebook**: list documents (name, size, strategy, chunk count, status), delete a document (removes its chunks from the table), re-ingest with a different strategy.
- **Multi-user data model**: all entities keyed by `userId`; storage paths namespaced by user; `AuthProvider` stub returns `local-user`.
- **Graceful error surfacing**: parse failures, Bedrock errors (access denied, throttling, validation, timeout), oversize files, and missing notebooks render as readable in-UI messages — request-level AND in-stream.

### Non-Goals (v1 — design for, don't build)

- Real auth / multi-tenant isolation enforcement (stub user; seam only — §10).
- External servers (Postgres, OpenSearch, Redis) — file + LanceDB only.
- Queue/worker infrastructure (SQS/Step Functions) — in-process jobs only.
- Presigned/multipart S3 upload — direct upload with a 50MB cap.
- PPTX / Office formats and multimodal (image) embeddings — **loader & embedding seams exist** for both.
- Excel per-row strategy — designed for, added later as one strategy entry.
- Notebook sharing/collaboration, versioning, S3 backup/restore.
- Deployment/IaC/CI/Docker.

## 3. Architecture

```
Browser (React client — holds notebookId + display state; no AWS/vector code)
  │
  │  POST   /api/notebooks                 create { name, embeddingModelId }
  │  GET    /api/notebooks                 list (for current user)
  │  GET    /api/notebooks/[id]            open (metadata + documents + totals)
  │  DELETE /api/notebooks/[id]            explicit delete (metadata + table + uploads)
  │  POST   /api/notebooks/[id]/documents  upload (multipart) → { jobId }  (202)
  │  GET    /api/jobs/[id]                 poll ingestion job status/progress
  │  GET    /api/jobs/[id]/stream          SSE ingestion progress (optional)
  │  DELETE /api/notebooks/[id]/documents/[docId]   remove doc + its chunks
  │  POST   /api/notebooks/[id]/query      { question, topK, filter } → SSE answer+citations
  │  GET    /api/strategies                strategy registry (client-safe)
  │  GET    /api/models                    Bedrock model registry (client-safe)
  ▼
Next.js route handlers (Node runtime — server-only)
  ├── validate (zod) + resolve user (AuthProvider) + delegate to Facade + stream
  ▼
FACADE   lib/facade/notebook-facade.ts
  createNotebook · listNotebooks · openNotebook · deleteNotebook
  ingestDocument · getJob · deleteDocument · query           (orchestrates services)
  ▼
SERVICES lib/services/*
  NotebookService     lifecycle; fixes embeddingModel/dim at creation
  IngestionService    Template Method: parse → chunk → embed → store; drives JobService
  ChunkingService     Strategy + Factory + Registry; selection (explicit | by-type default)
  EmbeddingService    Adapter over Bedrock; batched; asserts dim == notebook.dim
  QueryService        embed → vector search → prompt build → stream generation
  JobService          async job registry + progress (Observer/callbacks)
  ▼
REPOSITORIES / ADAPTERS lib/repositories/*  lib/adapters/*
  NotebookRepository · DocumentRepository · JobRepository   (FILE impls: JSON + atomic write + lock)
  VectorStore                                               (LanceDBVectorStore)
  Uploader                                                  (LocalDiskUploader)
  AuthProvider                                              (StubAuthProvider → local-user)
  BedrockEmbeddingAdapter · BedrockLLMAdapter               (AWS SDK v3, server-only)
  ▼
Local disk: ./data/users/{userId}/notebooks/{notebookId}/{notebook.json, documents/, lancedb/, uploads/}
            ./data/users/{userId}/jobs/{jobId}.json
Bedrock:    embeddings + generation (AWS_PROFILE / AWS_REGION)
```

- **Strict layering**: routes → facade → services → repositories/adapters. A route never imports a repository; a service never imports a route; components never touch AWS/LanceDB shapes.
- **Streaming**: SSE with a typed event union shared across the app (`lib/stream/events.ts`):
  - Ingestion job: `job-status | file-progress | doc-indexed | doc-error | job-done`.
  - Query: `retrieval | text-delta | citation | usage | done | error`.

## 4. Layering, Patterns & Directory Contracts

### 4.1 Patterns in use (named, justified)

| Pattern | Where | Why |
|---|---|---|
| **Facade** | `lib/facade/notebook-facade.ts` | Single coarse use-case API; routes stay thin; orchestration centralized |
| **Service** | `lib/services/*` | One responsibility each; business logic isolated from storage + web |
| **Repository** | `lib/repositories/*` | Storage-agnostic CRUD; file→Postgres is a swap |
| **Strategy** | `lib/chunking/strategies/*` | Interchangeable chunking algorithms — the core feature |
| **Registry** | `lib/chunking/registry.ts`, `lib/models/registry.ts` | Strategies & models as data; add = one entry |
| **Factory** | `lib/chunking/factory.ts`, `lib/models/factory.ts` | Resolve registry id → concrete instance; no `if` at call sites |
| **Adapter** | `lib/adapters/*` | Wrap Bedrock/LanceDB SDKs behind our interfaces |
| **Template Method** | `IngestionService.run()` | Fixed pipeline (parse→chunk→embed→store); chunk step delegated to Strategy |
| **Observer/Callback** | `JobService` progress | Ingestion emits progress; persisted for polling/SSE |

### 4.2 Layer rules (non-negotiable)

- Route handlers: zod validation, `AuthProvider.currentUser()`, one Facade call, SSE plumbing. **No business logic.**
- Facade: composes services for a use-case; owns cross-service orchestration + transaction-like ordering (e.g. write doc metadata *after* successful indexing). No storage calls directly — goes through services.
- Services: pure-ish business logic; depend on repository/adapter **interfaces**, never concrete impls (constructor-injected).
- Repositories/Adapters: the only code touching the filesystem, LanceDB, or AWS SDKs. All AWS error mapping lives in adapters.
- Components: render typed DTOs only; never see AWS/LanceDB/raw JSON shapes.

## 5. Chunking Strategy System (the bread and butter)

### 5.1 Core types

```ts
// lib/chunking/types.ts
export interface ParsedElement {          // loader output — structural unit pre-chunk
  kind: 'page' | 'paragraph' | 'text' | 'row';   // 'slide' | 'row' reserved for later
  text: string;
  metadata: Record<string, unknown>;      // e.g. { page: 12 }
}

export interface Chunk {
  ordinal: number;                         // sequence within the document
  text: string;
  metadata: {                              // provenance → flows into citations
    page?: number;
    charStart?: number;
    charEnd?: number;
    [k: string]: unknown;
  };
}

export interface StrategyConfigField {     // drives UI + zod validation
  key: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'select';
  default: unknown;
  min?: number; max?: number; step?: number;
  options?: { value: string; label: string }[];
  help?: string;
}

export interface ChunkingStrategy {
  id: string;                              // 'fixed_size'
  displayName: string;
  description: string;
  applicableTo(fileType: string): boolean; // 'txt' | 'pdf' | ...
  configSchema(): StrategyConfigField[];   // self-describing config
  chunk(elements: ParsedElement[], config: Record<string, unknown>): Chunk[];
}
```

### 5.2 Seed strategies (v1)

| id | displayName | applicable | config | behavior |
|---|---|---|---|---|
| `fixed_size` | Fixed size | all | `size`(chars/tokens), `overlap`, `unit` | Sliding window; overlap carried; splits across element boundaries |
| `recursive` | Recursive (smart) | all | `size`, `overlap`, `separators[]` | Split on paragraph→sentence→word, packing up to `size` |
| `delimiter` | Delimiter | txt, md, csv | `delimiter`, `keepDelimiter` | Split on a literal/regex delimiter (e.g. `\n\n`, `---`) |
| `pdf_one_per_page` | One chunk per page | pdf | `mergeShortPages`(bool), `minChars` | 1 chunk per PDF page; provenance `page` |

**Reserved (later, one entry each):** `pptx_one_per_slide` (pptx), `excel_one_per_row` (xlsx/csv), `semantic` (all).

### 5.3 Registry, Factory, selection

```ts
// lib/chunking/registry.ts
export const CHUNKING_STRATEGIES: ChunkingStrategy[] = [ /* seed instances */ ];

// default per file type (auto mode)
export const DEFAULT_STRATEGY_BY_TYPE: Record<string, string> = {
  txt: 'recursive',
  md:  'recursive',
  pdf: 'pdf_one_per_page',
  csv: 'delimiter',
  // pptx: 'pptx_one_per_slide',  // later
  // xlsx: 'excel_one_per_row',   // later
};

// lib/chunking/factory.ts
// resolve id → strategy; throw typed StrategyNotFound (never silent).
// selection: explicit strategyId+config, else DEFAULT_STRATEGY_BY_TYPE[fileType].
```

### 5.4 Behavior rules

- **UI**: `/api/strategies` returns applicable strategies + `configSchema` for the uploaded file type; the composer renders controls from the schema (slider for `size`, input for `delimiter`, etc.). **No hardcoded per-strategy UI.**
- **Server validation**: a zod schema is built **from the selected strategy's `configSchema`**; unknown fields stripped, ranges clamped. Never trust the client.
- **Per-document record**: the chosen `strategyId` + resolved `config` is stored on the `Document` and echoed into each chunk's row metadata in LanceDB.
- **Adding a strategy = one class implementing `ChunkingStrategy` + one registry entry (+ optional default-map entry).** Nothing else changes — UI, validation, provenance all derive from the interface.
- **Provenance → citations**: chunk `metadata.page` (etc.) is stored per LanceDB row and returned in query citations so the UI can render "PDF p.14" instead of "chunk 87".

## 6. Bedrock Model Registry

### 6.1 Types

```ts
// lib/models/types.ts
export interface EmbeddingModelConfig {
  id: string;                 // e.g. "amazon.titan-embed-text-v2:0"
  displayName: string;
  dim: number;                // FIXES the notebook's LanceDB vector dimension
  maxBatch: number;
  modality: 'text';           // 'multimodal' reserved (seam)
  notes?: string[];           // verification status
}

export interface LLMModelConfig {
  id: string;                 // e.g. "anthropic.claude-3-5-sonnet-...:0"
  displayName: string;
  contextWindow: number;
  supportsTemperature: boolean;
  defaultTemperature: number;
}

export const EMBEDDING_MODELS: EmbeddingModelConfig[] = [ /* seed §6.3 */ ];
export const LLM_MODELS: LLMModelConfig[] = [ /* seed §6.3 */ ];
```

### 6.2 Behavior rules

- **Notebook dimension is fixed at creation** from the chosen `EmbeddingModelConfig.dim`. It is **immutable once the notebook has any documents** — enforced server-side (changing it would invalidate stored vectors). Surface as a clear validation error, not a silent break.
- **No hardcoded dims** anywhere — always `notebook.dim` derived from the registry.
- **Temperature** control shown/sent only when `supportsTemperature`; clamped to range server-side.
- **Adding a model = one registry entry.** Provider differences (if any new family appears) live behind the adapter.

### 6.3 Seed registry (⚠️ MUST verify IDs/dims/region availability — see CLAUDE.md; flag, don't guess)

| kind | id (verify) | notes |
|---|---|---|
| embedding | `amazon.titan-embed-text-v2:0` | dim configurable (256/512/1024) — pick + verify; default 1024 |
| embedding | `cohere.embed-english-v3` | dim 1024 — verify availability |
| llm | `anthropic.claude-3-5-sonnet-20240620-v1:0` | temperature supported — verify current ID |

If an ID/dim/region can't be verified in the account, **flag to the user — do not guess.**

## 7. Frontend UX

### Layout

- **App shell**: left sidebar (notebook workspace) + main area (documents & chat). Dark-first (light supported via `next-themes`), Tailwind + shadcn/ui + `lucide-react`, `tabular-nums` for IDs/counts.
- **Notebook switcher** (sidebar top): list of the user's notebooks (name, doc count, created), "New Notebook" button (dialog: name + embedding-model select from registry — with a note that the model is fixed once documents exist).
- **Notebook workspace** (main, when a notebook is open):
  - **Documents panel**: table of documents — name, size, **strategy badge**, chunk count, status pill (`queued / parsing / chunking / embedding / indexed / error`), actions (delete, re-ingest). Error rows show reason on hover.
  - **Upload**: drag-and-drop + picker (multi-file, ≤ 50MB each; oversize rejected inline). On file select, an **ingestion settings** panel appears per file:
    - **Chunking mode toggle**: *Auto (by file type)* vs *Custom*.
    - In Custom: strategy select (only `applicableTo` this file type) + **schema-driven config controls** (`configSchema` → sliders/inputs/switches) with live preview of estimated chunk count where cheap.
  - Upload → creates jobs → per-file progress rows driven by job polling/SSE (phase label → ✓ chunk count, or ✗ reason).
  - **Chat/query area**:
    - Empty state (no indexed docs): "Add documents to start researching."
    - Messages: user right, assistant left; markdown + syntax-highlighted code; streaming text with subtle cursor.
    - **Retrieval strip** while searching (`Searching {n} chunks…`); answer renders inline citation markers `[1]…[k]` expanding into **source cards** (document name, page/location from provenance, snippet, similarity score).
    - Composer: auto-grow textarea, Enter=send / Shift+Enter=newline, `topK` control (bounded), optional document filter, Stop button while streaming.
    - Errors render as inline notices in the conversation.
  - **Delete Notebook** button (destructive; confirm dialog — explains it removes documents, vectors, uploads permanently).

### Polish

- Skeletons for notebook list, documents table, chat; optimistic disable states; copy affordances on IDs.
- Color conventions: violet = notebook/identity, blue = data/citations, amber = warnings (e.g. model-locked), red = errors/destructive.
- Keyboard: `⌘K` notebook switcher; `⌘Enter` send; `Esc` closes dialogs.
- No layout shift during streaming; smooth auto-scroll with scroll-lock when scrolled up.
- Strategy config controls are entirely **schema-driven** — a new strategy's controls appear with no UI code.

## 8. API Contracts

All requests resolve the current user via `AuthProvider` (stub → `local-user`); every entity/path is user-scoped. Unknown/notebook-not-owned → `404`.

### 8.1 Notebooks

- `POST /api/notebooks { name, embeddingModelId }` → `{ id, name, embeddingModelId, dim, createdAt }`. `dim` from registry; notebook LanceDB table provisioned lazily on first ingest.
- `GET /api/notebooks` → `[{ id, name, docCount, createdAt }]`.
- `GET /api/notebooks/[id]` → `{ notebook, documents[], totals: { documents, chunks }, embeddingModel, llmDefault }`.
- `DELETE /api/notebooks/[id]` → deletes metadata + LanceDB table dir + uploads → `{ deleted: true }`.

### 8.2 Documents & ingestion (async)

- `POST /api/notebooks/[id]/documents` (multipart) — fields: `file`, `chunkingMode: 'auto'|'custom'`, `strategyId?`, `strategyConfig?(JSON)`. Validates size (≤ 50MB) + type (txt/pdf) + strategy applicability + config (zod from `configSchema`). Creates a `Document` (status `queued`) + a `Job`, starts an **in-process background task**, returns **`202 { jobId, documentId }`**. Model immutability enforced if notebook already has docs.
- `GET /api/jobs/[id]` → `{ status, phase, processed, total, chunks?, error? }` (poll).
- `GET /api/jobs/[id]/stream` (SSE, optional) → `job-status | file-progress { phase } | doc-indexed { chunks } | doc-error { reason } | job-done`.
- `DELETE /api/notebooks/[id]/documents/[docId]` → removes doc metadata + deletes its rows from the LanceDB table (by `documentId` filter) → `{ deleted: true }`.

### 8.3 Query — `POST /api/notebooks/[id]/query` (SSE)

Request:

```json
{ "question": "…", "topK": 5, "filter": { "documentId": "…?" },
  "llmModelId": "…?", "temperature": 0.2 }
```

- Empty notebook → immediate `done { reason: "no_documents" }`, no LLM call.
- Embeds query with the **notebook's** embedding model, searches its LanceDB table (top-k, optional `SCORE_THRESHOLD`, optional metadata filter), builds a grounded prompt (numbered context blocks; instruction: answer only from context, cite sources, admit unknowns), streams generation.
- Stream: `retrieval { count }` → `text-delta { text }`* → `citation { index, documentId, documentName, page?, score, snippet }`* → `usage { inputTokens?, outputTokens? }` → `done`. Errors → `error { code, message }`.
- Client abort cancels fetch; server aborts the Bedrock stream.

### 8.4 Registries (client-safe)

- `GET /api/strategies?fileType=` → applicable strategies `[{ id, displayName, description, configSchema }]` + `defaultForType`.
- `GET /api/models` → `{ embeddingModels: [{id, displayName, dim, modality}], llmModels: [{id, displayName, supportsTemperature, defaultTemperature}] }` (no secrets).

## 9. Tech Stack

- **Next.js (App Router) + TypeScript strict.** Node runtime for all API routes (server-only AWS + LanceDB + fs).
- **LanceDB** via `@lancedb/lancedb` (prebuilt binaries; verify install per platform). One table per notebook, on local disk under the notebook dir.
- **AWS SDK v3**: `@aws-sdk/client-bedrock-runtime` (InvokeModel/embeddings + streaming generation). IDs/params **verified** per CLAUDE.md; versions pinned.
- **zod** — request validation on every route; strategy config schemas compiled to zod from `configSchema`.
- **Loaders**: `pdf-parse`/`pdfjs-dist` (PDF → per-page text for provenance), native fs + `chardet`/`iconv-lite` for text encoding fallback. PPTX loader **not built** (seam only).
- **UI**: Tailwind + shadcn/ui + `lucide-react` + `next-themes`; `react-markdown` + syntax highlighter; native `fetch`/`ReadableStream` for SSE.
- **No database server, no auth libs, no Docker, no queue.** File-based repositories + LanceDB + in-process jobs.

## 10. Configuration

```bash
# .env.local (from committed .env.local.example)
AWS_REGION=us-east-1
AWS_PROFILE=<profile>                 # SSO: run `aws sso login` first
DATA_DIR=./data                       # root for file repos + LanceDB tables
DEFAULT_USER_ID=local-user            # AuthProvider stub

# Defaults (registry-overridable per notebook/document)
DEFAULT_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0
DEFAULT_LLM_MODEL_ID=anthropic.claude-3-5-sonnet-20240620-v1:0
DEFAULT_TOP_K=5
SCORE_THRESHOLD=0.0
MAX_FILE_MB=50
```

- Registries (strategies + models) live in **code** (typed data), not env. Env supplies region/profile/paths/defaults.

## 11. Extensibility Seams (build the shapes now)

- **AuthProvider** → `currentUser(): { userId }`. Stub returns `DEFAULT_USER_ID`; Cognito/Clerk impl later. All data already user-scoped.
- **Repository interfaces** → `NotebookRepository`, `DocumentRepository`, `JobRepository`. File impls now; Postgres/Dynamo later — same methods.
- **VectorStore** → `ensureCollection/add/search/delete`. `LanceDBVectorStore` now; `OpenSearchVectorStore` later (for serverless). QueryService depends on the interface only.
- **Uploader** → local-disk now; presigned-S3/multipart later (for 200MB files). Route stays the same shape.
- **IngestionQueue** → in-process task runner behind an interface; SQS/Step-Functions/Fargate-worker later. `IngestionService` doesn't care who invokes it.
- **Loader registry** → per-type `Loader` producing `ParsedElement[]`; add PPTX/XLSX later as one loader each — all applicable strategies work immediately.
- **Embedding modality** → `modality: 'text' | 'multimodal'`; Titan Multimodal + image chunks slot in behind `EmbeddingService` with no store/query rewrite.

## 12. Acceptance Criteria

- [ ] `npm install` then `npm run dev` → app at `localhost:3000`; a `./data` tree is created on first write; no external servers required.
- [ ] Create a notebook (name + embedding model) → dim fixed from registry; appears in the switcher; delete removes metadata + LanceDB table + uploads.
- [ ] Upload txt and PDF (≤ 50MB) → each returns `202 { jobId }`; ingestion runs in the background; the documents table shows live phase progress and final chunk counts; oversize/corrupt/empty files fail **per-document** with a readable reason **without** affecting siblings or crashing the server.
- [ ] **Auto mode** applies the default strategy per file type (PDF→`pdf_one_per_page`, txt→`recursive`); **Custom mode** shows only `applicableTo` strategies with **schema-driven** config controls; the server validates config from the strategy's `configSchema` (clamps/strips).
- [ ] The chosen strategy + config is recorded per document and shown as a badge; re-ingesting a document with a different strategy replaces its chunks.
- [ ] Query streams a grounded answer with inline citations that expand to show document, **page/location from provenance**, snippet, and similarity score; querying an empty notebook returns a "no documents" notice with no LLM call; Stop halts generation immediately.
- [ ] Embedding model is **immutable once a notebook has documents** — attempting to change it is rejected with a readable error; no hardcoded vector dim exists (dim always derives from the notebook's registry model).
- [ ] Temperature control appears only for LLMs that support it; unsupported/out-of-range values stripped/clamped server-side.
- [ ] Layering holds: routes contain no business logic; services depend only on repository/adapter interfaces; components never see AWS/LanceDB raw shapes (verifiable by inspection).
- [ ] **Adding a chunking strategy requires ONLY** a new `ChunkingStrategy` class + one registry entry (+ optional default-map entry) — demonstrably no UI/validation/route edits. Adding a model = one registry entry.
- [ ] Bedrock errors (access denied, throttling, validation, timeout) and missing-notebook errors render as readable in-UI messages (request-level AND in-stream).
- [ ] No AWS SDK / LanceDB code ships in the client bundle.
- [ ] Deleting a document removes its vectors from the notebook's table (subsequent queries can't cite it).

## 13. Project Structure

```
/app
  layout.tsx  page.tsx                     # console shell (sidebar + workspace)
  /api
    /notebooks/route.ts                     # POST create, GET list
    /notebooks/[id]/route.ts                # GET open, DELETE
    /notebooks/[id]/documents/route.ts      # POST upload → 202 { jobId }
    /notebooks/[id]/documents/[docId]/route.ts  # DELETE doc
    /notebooks/[id]/query/route.ts          # SSE query
    /jobs/[id]/route.ts                     # GET job status (poll)
    /jobs/[id]/stream/route.ts              # SSE job progress (optional)
    /strategies/route.ts                    # client-safe strategy registry
    /models/route.ts                        # client-safe model registry
/lib
  /facade
    notebook-facade.ts                      # use-case orchestration
  /services
    notebook-service.ts  ingestion-service.ts  chunking-service.ts
    embedding-service.ts query-service.ts   job-service.ts
  /repositories
    types.ts                                # NotebookRepository/DocumentRepository/JobRepository interfaces
    file-notebook-repository.ts             # JSON + atomic write + lock
    file-document-repository.ts
    file-job-repository.ts
    fs-util.ts                              # atomic write, per-file lock, path builders (user-scoped)
  /adapters
    vector-store.ts                         # VectorStore interface
    lancedb-vector-store.ts                 # LanceDB impl
    uploader.ts  local-disk-uploader.ts     # Uploader interface + impl
    auth-provider.ts  stub-auth-provider.ts # AuthProvider interface + stub
    bedrock-embedding-adapter.ts            # Bedrock embeddings + error mapping (server-only)
    bedrock-llm-adapter.ts                  # Bedrock streaming generation + error mapping
  /chunking
    types.ts  registry.ts  factory.ts       # Strategy + Registry + Factory
    /strategies
      fixed-size.ts  recursive.ts  delimiter.ts  pdf-one-per-page.ts
    /loaders
      types.ts  registry.ts                 # Loader → ParsedElement[]
      text-loader.ts  pdf-loader.ts          # (pptx-loader.ts later)
  /models
    types.ts  registry.ts  factory.ts       # Bedrock model registry
  /stream
    events.ts                               # typed SSE event union (server+client)
  /errors
    errors.ts                               # error taxonomy + AWS→readable mapping
  /jobs
    ingestion-queue.ts                      # IngestionQueue interface + in-process impl
/components
  /notebook   /documents   /upload   /chat   /ui
/data                                       # created at runtime (gitignored)
.env.local.example
```