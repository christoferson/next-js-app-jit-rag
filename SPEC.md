# SPEC.md — Ephemeral RAG Console (Session-Scoped FAISS)

## 1. Overview

A local-first web application that gives each browser session its own **ephemeral Retrieval-Augmented Generation database**. A user opens the app, uploads one or more documents, and immediately chats/queries over their contents. Behind the scenes, the backend parses each file, chunks and embeds it, and builds a **per-session FAISS index held entirely in memory**. Queries embed the question, retrieve the top-k chunks from that session's index, and stream a grounded LLM answer with citations back to the UI.

Nothing is persisted. A session — and its FAISS index, decoded documents, and temp files — is destroyed the moment the user **ends the session**, closes the tab, or lets it sit **idle for 5 minutes**. There are no user accounts, no shared indexes, and no on-disk vector store that survives a restart.

Two-service architecture: a **Python FastAPI backend** (owns FAISS, embeddings, parsing, LLM calls, and the session reaper) and a **Next.js frontend** (upload, chat, session status). Run both with a single `make dev` / `docker compose up`.

Four architectural mandates:

1. **Provider Registry**: embedding and LLM behavior (which model, dimensions, context window, request params, availability) is modeled as typed metadata. All provider-specific behavior — index dimensionality, request fields, validation, UI options — is driven by this registry, never hardcoded at call sites. **Adding a model/provider = one registry entry.**
2. **Ephemeral by construction**: session state (FAISS index + doc store + file bytes) lives **only in process memory / a per-session temp dir**. There is no durable database. Eviction (idle, explicit, or shutdown) must free all memory and delete all temp files — verifiable. A restart starts empty.
3. **Defensive ingestion**: uploaded files are heterogeneous and hostile (wrong extensions, corrupt PDFs, empty docs, huge files, mixed encodings). Every parser/loader must degrade gracefully — **never crash the server on a bad file**; a bad file is rejected per-file with a readable reason, and other files in the same upload still succeed.
4. **Ideal, stylish UI**: dark-first console aesthetic, live upload/ingestion progress, animated streaming answers with inline citations, a visible **session countdown timer**, keyboard-friendly. UI quality is a first-class requirement (see §7).

Default config via environment. Credentials (e.g. OpenAI key) via env, server-only.

## 2. Goals & Non-Goals

### Goals

- **Session bootstrap**: on first load, the client obtains a `sessionId` (server-issued UUID) bound to an in-memory session. The `sessionId` is the only key the client holds.
- **Multi-file upload**: drag-and-drop or picker; 1..N files per upload, repeatable (add more files to an existing session's index). Supported types: `.pdf`, `.txt`, `.md`, `.docx`, `.csv`, `.html` (see §5.1). Per-file size cap and per-session total cap from config.
- **Ingestion pipeline**: parse → normalize text → chunk (configurable size/overlap) → embed → add to the session's FAISS index, with per-file, **streamed progress** (parsing → chunking → embedding → indexed) and per-file chunk counts.
- **RAG query with streaming**: embed the query, retrieve top-k chunks (configurable k, optional score threshold), build a grounded prompt, stream the LLM answer token-by-token, and return **citations** (source filename + chunk index + snippet + similarity score) that the UI can render inline and expand.
- **Session dashboard**: show session ID, uploaded files (name, size, chunk count, status), total chunks/vectors, index dimensionality/provider, **idle countdown to expiry**, and controls to add files, clear the index, or end the session.
- **Explicit + implicit teardown**:
  - **End Session** button → immediate server-side eviction (free FAISS, delete temp dir).
  - **Tab close / navigate away** → `navigator.sendBeacon` best-effort end.
  - **Idle 5 min** → background reaper evicts; the client, on its next call, receives `410 Gone` and offers to start a fresh session.
- **Activity-based TTL refresh**: any successful query/upload/heartbeat resets the session's idle timer server-side; the UI countdown reflects `expiresAt` from the server.
- **Graceful error surfacing**: parse failures, embedding/LLM provider errors (auth, rate limit, timeout), expired sessions, and oversized uploads all render as readable in-UI messages — request-level AND in-stream.

### Non-Goals (v1 — design for, don't build)

- Durable / cross-session vector storage, persistence, or resuming a session after server restart.
- Auth / multi-user isolation beyond the opaque `sessionId` (single-tenant local tool; seam exists — §10).
- Multi-modal input (images, audio); OCR of scanned PDFs.
- Distributed / horizontally-scaled backend (single process; in-memory store — see §10 for the Redis/shared seam).
- Fine-grained document management (rename, re-order, per-chunk editing).
- Cost tracking, guardrails, evaluation harnesses.
- Deployment/IaC/CI beyond a local `docker compose`.

## 3. Architecture

```
Browser (Next.js client — holds only sessionId + display state)
  │
  │  POST /api/session                 → { sessionId, expiresAt, config }
  │  POST /api/session/heartbeat       → { expiresAt }            (resets idle)
  │  DELETE /api/session               → best-effort teardown (sendBeacon)
  │  GET  /api/session/status          → files, counts, expiresAt
  │  POST /api/upload  (multipart)     → SSE ingestion progress per file
  │  POST /api/query                   → { question, topK } → SSE answer + citations
  │  POST /api/clear                   → drop index, keep session
  │  GET  /api/providers               → client-safe provider registry
  ▼
FastAPI backend (single process — owns all state)
  ├── session/manager.py       SessionManager: in-mem dict, locks, TTL, reaper
  ├── session/store.py         SessionStore: FAISS index + DocStore + temp dir
  ├── rag/loaders.py           defensive per-type file → text (pure-ish)
  ├── rag/chunker.py           text → chunks (size/overlap)
  ├── rag/embeddings.py        provider-driven embed(texts) -> np.ndarray
  ├── rag/index.py             FAISS build/add/search wrapper (per session)
  ├── rag/generate.py          prompt build + streaming LLM adapter
  ├── providers/registry.py    typed embedding+LLM metadata (data only)
  └── providers/validate.py    request validation built from registry
  ▼
SSE back to client (ingestion progress, text deltas, citations, usage, errors)

Background: reaper task (asyncio) sweeps every REAPER_INTERVAL for idle sessions.
```

- **Stateful backend, ephemeral state**: unlike a stateless service, the backend deliberately holds per-session state in memory — but that state is disposable and TTL-bounded. Every request carries `sessionId`; the manager resolves it, refreshing its `last_activity`.
- **Layering**:
  - `session/*` — lifecycle, concurrency, memory/temp ownership. Only place that creates/destroys FAISS indexes and temp dirs.
  - `rag/*` — as-pure-as-possible transforms (loaders, chunker) and thin provider wrappers (embeddings, generate). No web framework imports.
  - `providers/*` — registry (data) + validation. No `if provider == ...` at call sites.
  - Route handlers — validation (Pydantic) + wiring + SSE only.
- **Streaming**: SSE with a typed event union shared by contract between server and client (`lib/events`):
  - Ingestion: `file-start | file-progress | file-indexed | file-error | ingest-done`.
  - Query: `retrieval | text-delta | citation | usage | done | error`.

## 4. Session Lifecycle & Ephemeral Store (the core design)

### 4.1 Session state

```py
# session/store.py
@dataclass
class SessionStore:
    session_id: str
    created_at: float
    last_activity: float          # refreshed on every successful op
    ttl_seconds: int              # default 300 (5 min)
    temp_dir: Path                # per-session; deleted on eviction
    index: faiss.Index | None     # IndexFlatIP over normalized embeddings
    dim: int                      # from embedding provider registry
    docs: DocStore                # chunk_id -> {file, chunk_index, text, char_span}
    files: list[FileRecord]       # name, bytes, sha256, status, chunk_count
    lock: asyncio.Lock            # serialize add/search per session
```

- **Index type**: `IndexFlatIP` on L2-normalized vectors (cosine similarity) — exact, no training, ideal for small ephemeral corpora. Registry may specify `IndexHNSWFlat` for large sessions later (seam).
- **DocStore**: parallel array/dict mapping FAISS row → chunk metadata; FAISS stores only vectors, DocStore stores text + provenance for citations.

### 4.2 Manager rules

```py
# session/manager.py
class SessionManager:
    sessions: dict[str, SessionStore]
    def create() -> SessionStore
    def get(session_id) -> SessionStore            # raises SessionExpired -> 410
    def touch(session_id)                          # last_activity = now
    async def evict(session_id, reason)            # free index, rm temp_dir
    async def reap()                               # evict idle > ttl
```

- **Idle expiry**: `now - last_activity > ttl_seconds` → evicted. `expiresAt = last_activity + ttl_seconds` is returned to the client on every response so the UI countdown is authoritative.
- **`get()` on an evicted/unknown id → `SessionExpired` → HTTP `410 Gone`** with `{ code: "session_expired" }`. Never auto-recreate silently; the client decides.
- **Eviction is total and verifiable**: drop the FAISS index reference, clear DocStore, `shutil.rmtree(temp_dir)`. Log `{session_id, reason, freed_vectors, files}`. Reasons: `explicit | idle | shutdown | error`.
- **Reaper**: asyncio task started on app startup, runs every `REAPER_INTERVAL` (default 30s), evicts all idle sessions. On app shutdown, evict all sessions.
- **Concurrency**: per-session `asyncio.Lock` guards index add/search so concurrent upload + query don't corrupt the index. Manager dict guarded by a global lock for create/evict.
- **Caps**: reject uploads exceeding `MAX_FILE_MB` (per file) or `MAX_SESSION_MB` / `MAX_SESSION_CHUNKS` (per session) with a readable error; existing index untouched.

### 4.3 Teardown paths (all must free everything)

| Trigger | Mechanism | Result |
|---|---|---|
| End Session button | `DELETE /api/session` | `evict(explicit)` immediately |
| Tab close / unload | `navigator.sendBeacon('/api/session', ...)` | best-effort `evict(explicit)` |
| Idle 5 min | reaper | `evict(idle)`; next client call → `410` |
| Server shutdown | lifespan hook | `evict(shutdown)` for all |

## 5. RAG Pipeline

### 5.1 Loaders (`rag/loaders.py`) — defensive per-type

| Type | Loader | Failure handling |
|---|---|---|
| `.txt`, `.md` | decode with `charset-normalizer` fallback chain | undecodable → `file-error` |
| `.pdf` | `pypdf` (text extraction) | encrypted/scanned/empty text → `file-error("no extractable text")` |
| `.docx` | `python-docx` | corrupt → `file-error` |
| `.csv` | row-serialized to text | huge → truncate to cap, warn |
| `.html` | `selectolax`/`beautifulsoup` text extraction | — |

- Unknown/mismatched extension or MIME → rejected per-file with reason; **other files continue**.
- Empty extracted text → `file-error("empty document")`, not indexed.
- Every loader returns `LoadedDoc{ text, meta }` or raises `LoaderError(reason)` — **never** an uncaught exception to the route.

### 5.2 Chunking (`rag/chunker.py`)

- Recursive/character splitter with `CHUNK_SIZE` (default 1000 chars) and `CHUNK_OVERLAP` (default 150). Config-driven; no per-file-type branching beyond registry-expressible options.
- Each chunk carries `{ file, chunk_index, char_start, char_end, text }`.

### 5.3 Embeddings (`rag/embeddings.py`) — registry-driven

- Provider chosen from the **Provider Registry** (§6). `embed(texts) -> np.ndarray[float32, (n, dim)]`, L2-normalized.
- `dim` **must** match `SessionStore.dim`; a session's index dimension is fixed at creation from the active embedding model. Switching embedding models mid-session is disallowed (would invalidate vectors) — surfaced as a validation error.
- Batched; provider errors (auth/rate-limit/timeout) mapped to readable messages.

### 5.4 Retrieval + generation (`rag/index.py`, `rag/generate.py`)

- **Retrieve**: embed query → `index.search(q, topK)` → map rows via DocStore → `[{text, file, chunk_index, score}]`, optional `SCORE_THRESHOLD` filter. Empty index → answer with a clear "no documents uploaded yet" notice, no LLM call.
- **Generate**: build a grounded prompt (system instruction: "answer only from context, cite sources, say when unknown") with numbered context blocks; stream tokens via the registry-selected LLM. Emit a `citation` SSE event per used source, then `usage` (tokens if provided) and `done`.
- Answers must be attributable: citations reference the exact retrieved chunks; the UI links inline markers `[1]`, `[2]` to expandable source cards.

## 6. Provider Registry (mirrors the ephemeral-store mandate)

### 6.1 Types

```py
# providers/registry.py
@dataclass(frozen=True)
class EmbeddingModel:
    id: str                    # "openai:text-embedding-3-small"
    display_name: str
    dim: int                   # fixes index dimensionality
    max_batch: int
    provider: str              # "openai" | "local" | ...
    available: bool            # gated by env/keys at startup

@dataclass(frozen=True)
class LLMModel:
    id: str                    # "openai:gpt-4o-mini"
    display_name: str
    provider: str
    context_window: int
    supports_temperature: bool # gate the UI control + request field
    default_temperature: float
    available: bool

EMBEDDING_MODELS: list[EmbeddingModel] = [ ... ]   # seed §6.3
LLM_MODELS: list[LLMModel] = [ ... ]               # seed §6.3
```

### 6.2 Behavior rules

- **UI**: model selectors populated from `/api/providers` (only `available` entries). Temperature slider shown only when `supports_temperature`.
- **Validation**: `/api/query` builds request validation from the selected LLM's metadata (strip/clamp temperature for unsupported/out-of-range). **Never trust the client.**
- **Index dimension** derives solely from the active `EmbeddingModel.dim`. No hardcoded 1536 at call sites.
- **No provider branching at call sites**: differences live in registry metadata + a thin per-provider adapter selected by `provider`. **Adding a model = one registry entry (+ adapter only if a new provider family).**

### 6.3 Seed registry (verify keys/availability at startup — flag, don't guess)

| kind | id | notes |
|---|---|---|
| embedding | `openai:text-embedding-3-small` | dim 1536, default |
| embedding | `local:bge-small-en-v1.5` | dim 384, offline via sentence-transformers |
| llm | `openai:gpt-4o-mini` | temperature supported, default 0.2 |
| llm | `local:ollama/llama3.1` | temperature supported; requires local Ollama |

If a provider's credentials/host are absent, mark `available: false` and surface it — do not fail requests silently.

## 7. Frontend UX

### Layout

- **App shell**: left sidebar (session dashboard) + main chat/query area. Dark-first (light supported), Tailwind + shadcn/ui + `lucide-react`, `tabular-nums` for IDs/counts.
- **Sidebar (session dashboard)**:
  - Session card: `sessionId` (truncated + copy), created-at, provider names (embedding + LLM).
  - **Idle countdown**: prominent `mm:ss` ticking toward `expiresAt`; turns amber < 60s, red < 15s; resets visibly on activity. Tooltip explains the 5-minute idle rule.
  - **Files list**: per file — name, size, status pill (`parsing / chunking / embedding / indexed / error`), chunk count; error files show the reason on hover.
  - Totals: files, chunks, vectors, index dim.
  - Controls: **Add files** (opens uploader), **Clear index** (keep session), **End Session** (destructive).
- **Upload zone**: drag-and-drop + picker; multi-file; shows a per-file progress row driven by ingestion SSE (spinner → phase label → ✓ with chunk count, or ✗ with reason). Oversized files rejected inline before upload.
- **Query/chat area**:
  - Empty state: "Upload documents to start asking questions" with the supported-types list.
  - Messages: user right, assistant left; markdown + syntax-highlighted code; streaming text with a subtle cursor; disabled composer + hint when index is empty.
  - **Retrieval strip**: while retrieving, show `Searching {n} chunks…`; on answer, inline citation markers `[1]…[k]` that expand into source cards (filename, chunk #, snippet, similarity score).
  - Composer: auto-grow textarea, Enter=send / Shift+Enter=newline, `topK` control (registry-bounded), Stop button while streaming.
  - Errors render as inline notices in the conversation.
- **Expired-session interstitial**: on any `410`, show a modal — "This session expired after inactivity" — with **Start new session** (creates fresh session, clears UI). Never silently lose the user.

### Polish requirements

- Skeletons for the files list and status; optimistic disable states; copy affordances on IDs.
- Color conventions: violet = session/identity, blue = data/citations, amber = warnings/expiry-soon, red = errors/expiry.
- Keyboard: `⌘K` focuses query, `Esc` closes modals/uploader.
- No layout shift during streaming; smooth auto-scroll with scroll-lock when scrolled up.
- Heartbeat: client pings `/api/session/heartbeat` while the tab is focused (e.g. every 60s) so an actively-viewed-but-quiet session doesn't expire mid-read — but a hidden/closed tab lets it expire.

## 8. API Contracts

### 8.1 Session

- `POST /api/session` → `{ sessionId, createdAt, expiresAt, config: { supportedTypes, maxFileMb, maxSessionMb, ttlSeconds } }`.
- `POST /api/session/heartbeat { sessionId }` → `{ expiresAt }` (touches). `410` if expired.
- `GET /api/session/status?sessionId=` → `{ files[], totals, dim, providers, expiresAt }`. `410` if expired.
- `DELETE /api/session { sessionId }` (also reachable via `sendBeacon`) → `{ ended: true }`; unknown id → `{ ended: false }` (never 5xx).
- `POST /api/clear { sessionId }` → drops index + DocStore + files, keeps the session alive → `{ cleared: true, expiresAt }`.

### 8.2 Upload — `POST /api/upload` (multipart, SSE)

- Form: `sessionId` + `files[]`. Server streams, per file:
  - `file-start { name, size }`
  - `file-progress { name, phase: "parsing"|"chunking"|"embedding", pct? }`
  - `file-indexed { name, chunks }`
  - `file-error { name, reason }`
  - terminal `ingest-done { indexedFiles, totalChunks, expiresAt }`
- Caps enforced before/after; a rejected file emits `file-error` and does not abort the batch. Touches session on success.

### 8.3 Query — `POST /api/query` (SSE)

Request:

```json
{ "sessionId": "…", "question": "…", "topK": 4,
  "llmModelId": "…?", "temperature": 0.2 }
```

- `llmModelId`/`temperature` optional, registry-gated/clamped; empty index → immediate `done` with a "no documents" notice.
- Stream: `retrieval { count }` → `text-delta { text }`* → `citation { index, file, chunkIndex, score, snippet }`* → `usage { inputTokens?, outputTokens? }` → `done`. In-stream/provider errors → `error { code, message }`.
- Client abort cancels the fetch; server stops the LLM stream. Touches session.

### 8.4 Providers

- `GET /api/providers` → `{ embeddingModels: [{id, displayName, dim, provider, available}], llmModels: [{id, displayName, supportsTemperature, defaultTemperature, provider, available}], active: { embeddingId, llmId } }` (client-safe; no secrets).

## 9. Tech Stack

- **Backend**: Python 3.11+, FastAPI + Uvicorn, `faiss-cpu`, `numpy`, Pydantic v2 (request validation), `sse-starlette` for SSE. Loaders: `pypdf`, `python-docx`, `charset-normalizer`, `selectolax`. Embeddings/LLM: `openai` SDK and/or `sentence-transformers` (local) and/or Ollama HTTP — selected by registry.
- **Frontend**: Next.js (App Router) + TypeScript strict; Tailwind + shadcn/ui + `lucide-react` + `next-themes`; `react-markdown` + syntax highlighter; native `fetch`/`ReadableStream` for SSE. Frontend calls the FastAPI backend directly (or via Next rewrites); **no vector/LLM code in the client bundle**.
- **No database, no auth libraries, no durable storage.** FAISS indexes and temp files only.
- Versions pinned; `faiss-cpu` install verified per platform.

## 10. Configuration

```bash
# .env (from committed .env.example)
# Session
SESSION_TTL_SECONDS=300           # 5-minute idle expiry
REAPER_INTERVAL_SECONDS=30
MAX_FILE_MB=25
MAX_SESSION_MB=100
MAX_SESSION_CHUNKS=5000

# RAG
CHUNK_SIZE=1000
CHUNK_OVERLAP=150
DEFAULT_TOP_K=4
SCORE_THRESHOLD=0.0

# Providers
EMBEDDING_MODEL_ID=openai:text-embedding-3-small
LLM_MODEL_ID=openai:gpt-4o-mini
OPENAI_API_KEY=<key>              # required for openai providers
OLLAMA_BASE_URL=http://localhost:11434   # for local providers

# Frontend
NEXT_PUBLIC_API_BASE=http://localhost:8000
```

- Registry lives in code (typed data), not env; env only selects active defaults and supplies credentials.

## 11. Extensibility Seams (build the shapes now)

- **Shared store**: `SessionManager` behind an interface so the in-memory dict can be swapped for Redis + a shared/on-disk FAISS (or per-session mmap) to support multiple backend replicas — without touching routes.
- **Identity**: `sessionId` is opaque; a future `useSession()` + auth layer can bind sessions to authenticated users; TTL/eviction logic unchanged.
- **Provider registry**: add embedding/LLM models as data; new provider *families* add one adapter keyed by `provider`.
- **Index type**: registry field to select `IndexHNSWFlat` for large sessions; `SessionStore` already isolates index construction.
- **Reranking / hybrid search**: retrieval step is a single function — a reranker or BM25 hybrid slots in behind it.
- **Persistence opt-in**: eviction is centralized; a "pin session" flag could snapshot an index to disk later (explicitly out of v1's ephemeral guarantee).

## 12. Acceptance Criteria

- [ ] `docker compose up` (or `make dev`) → frontend at `localhost:3000`, backend at `:8000`; loading the app creates a session with a visible countdown.
- [ ] Uploading multiple files streams per-file progress (parsing→chunking→embedding→indexed) with chunk counts; a corrupt/empty/oversized file is rejected with a readable reason **while other files in the same batch still index**.
- [ ] Adding more files to an existing session grows the same index; totals (files/chunks/vectors) update.
- [ ] Querying streams a grounded answer token-by-token with inline citations that expand to show file, chunk index, snippet, and similarity score; querying an empty index returns a clear "no documents" notice without an LLM call.
- [ ] Any successful upload/query/heartbeat resets the idle timer; `expiresAt` from the server drives the UI countdown; countdown turns amber/red as expiry approaches.
- [ ] **Idle 5 minutes** → the session is evicted by the reaper; the next client call returns `410`, and the UI shows an expired interstitial with "Start new session". Memory freed and temp dir deleted (verifiable in logs).
- [ ] **End Session** and **tab close** (`sendBeacon`) both free the FAISS index and delete the temp dir immediately; unknown/expired ids return a non-error `{ ended: false }`.
- [ ] **Clear index** empties documents/vectors but keeps the session and timer.
- [ ] Server restart starts with **zero** sessions/indexes (no persistence).
- [ ] Temperature control appears only for registry LLMs that support it; the server strips/clamps it otherwise; index dimensionality always derives from the active embedding model's `dim` (no hardcoded dims).
- [ ] Provider auth/rate-limit/timeout and expired-session errors render as readable in-UI messages (request-level AND in-stream); malformed files or stream events never crash the server or client.
- [ ] No vector/embedding/LLM code ships in the client bundle.
- [ ] Adding a model requires **ONLY** a new registry entry (plus an adapter only for a brand-new provider family).

## 13. Project Structure

```
/backend
  app.py                        # FastAPI app, lifespan (start/stop reaper), routes wiring
  /api
    session.py                  # create / heartbeat / status / delete / clear
    upload.py                   # SSE ingestion
    query.py                    # SSE RAG answer
    providers.py                # client-safe registry
  /session
    manager.py                  # SessionManager: dict, locks, TTL, reaper, evict-all
    store.py                    # SessionStore, DocStore, FileRecord
  /rag
    loaders.py                  # defensive per-type file -> text
    chunker.py                  # text -> chunks
    embeddings.py               # registry-driven embed()
    index.py                    # FAISS build/add/search (per session)
    generate.py                 # prompt build + streaming LLM adapter
  /providers
    registry.py                 # EmbeddingModel/LLMModel seed data
    validate.py                 # request validation from registry
    adapters/                   # openai.py, local.py, ollama.py
  /lib
    events.py                   # typed SSE event schemas (source of truth)
    errors.py                   # provider/session error mapping
  requirements.txt
  .env.example

/frontend
  /app
    page.tsx                    # console shell (sidebar + query area)
  /components
    /session                    # session card, countdown, files list
    /upload                     # dropzone + per-file progress
    /chat                       # messages, composer, citations, retrieval strip
    /ui                         # shadcn
  /lib
    api.ts                      # typed backend client (fetch + SSE parsing)
    events.ts                   # mirror of backend event union
    useSession.ts               # session bootstrap + heartbeat + expiry handling
  .env.example

docker-compose.yml
Makefile
README.md
```