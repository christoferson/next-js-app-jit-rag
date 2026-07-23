# CLAUDE.md — Build Guide & Verification for the Notebook RAG Console

Operational companion to `SPEC.md`. `SPEC.md` says *what* to build; this says *how to build it, in what order, and what MUST be verified before you depend on it.* Read `SPEC.md` first.

## 0. Prime Directives

1. **Never guess an AWS model ID, embedding dimension, SDK shape, or package capability.** If you can't verify it (official docs, a probe script, an actual import/call), **stop and flag it** with a `⚠️ VERIFY` note in your output. Do not write plausible-looking Bedrock model IDs or vector dims from memory — this is the #1 source of silent breakage.
2. **The chunking Strategy system is the product.** Its extensibility guarantee ("add a strategy = one class + one registry entry, nothing else changes") is a hard acceptance test, not an aspiration. Prove it (§6).
3. **Layering is enforced, not suggested.** Routes → Facade → Services → Repositories/Adapters. A violation (route touching a repo, service importing AWS SDK directly, component seeing a raw LanceDB row) is a defect (§5).
4. **Everything is user-scoped from line one.** Every entity carries `userId`; every path is namespaced by user. The `AuthProvider` stub is the *only* place the current user is resolved.
5. **Server-only secrets/SDKs.** No AWS SDK, no LanceDB, no `AWS_PROFILE` in the client bundle. The browser holds `notebookId` + display state only.

If this file and `SPEC.md` conflict: `SPEC.md` wins on *what*, this wins on *process*.

## 1. Environment Verification (FIRST — before any feature code)

Record results in `VERIFICATION.md`. Do not build on anything here until it passes.

### 1.1 LanceDB (`@lancedb/lancedb`) install + round-trip

Prebuilt binaries vary by platform/arch/Node version. Verify before pinning.

```ts
// scripts/verify-lancedb.ts  (run with tsx/ts-node)
import * as lancedb from "@lancedb/lancedb";

const db = await lancedb.connect("./.verify/lancedb");
const dim = 8;
const rows = Array.from({ length: 5 }, (_, i) => ({
  id: `r${i}`,
  documentId: "doc1",
  text: `row ${i}`,
  vector: Array.from({ length: dim }, () => Math.random()),
}));
const tbl = await db.createTable("probe", rows, { mode: "overwrite" });
const q = rows[0].vector;
const hits = await tbl.search(q).limit(3).toArray();
console.log("lancedb OK", hits.length, hits[0]?.id);
// also verify metadata filter + delete-by-filter (needed for doc deletion):
await tbl.delete(`documentId = 'doc1'`);
console.log("delete-by-filter OK", await tbl.countRows());
```

- ✅ prints results + `delete-by-filter OK 0` → pin the working version.
- ❌ install/import/binary error → record platform + Node version; try a different Node LTS; **flag to the user with the exact error** — do NOT substitute another vector lib without asking.
- **Verify these specific capabilities** (the app depends on them): create table, vector search with `.limit()`, **metadata filtering** (`.where(...)`), and **delete-by-filter** (for document removal). Note the exact API names — LanceDB's JS API surface has changed across versions.

### 1.2 Bedrock — embeddings + streaming generation (⚠️ the critical verify)

Do **not** proceed on assumed model IDs or dims. Probe the actual account.

```ts
// scripts/verify-bedrock.ts
import { BedrockRuntimeClient, InvokeModelCommand,
         InvokeModelWithResponseStreamCommand } from "@aws-sdk/client-bedrock-runtime";

const client = new BedrockRuntimeClient({ region: process.env.AWS_REGION });

// EMBEDDING: verify id + REAL output dimension
const embId = process.env.DEFAULT_EMBEDDING_MODEL_ID!;
const embRes = await client.send(new InvokeModelCommand({
  modelId: embId,
  body: JSON.stringify({ inputText: "hello world" /* + dimensions/normalize per model schema — VERIFY */ }),
  contentType: "application/json", accept: "application/json",
}));
const embJson = JSON.parse(new TextDecoder().decode(embRes.body));
console.log("embedding OK", embId, "REAL dim =", embJson.embedding?.length);
// ⚠️ Assert this REAL dim matches the registry `dim`. Mismatch = silent corruption. Fail loudly.

// LLM: verify id + streaming
const llmId = process.env.DEFAULT_LLM_MODEL_ID!;
const stream = await client.send(new InvokeModelWithResponseStreamCommand({
  modelId: llmId,
  body: JSON.stringify({ /* provider-specific body — VERIFY exact schema (Anthropic messages, etc.) */ }),
  contentType: "application/json", accept: "application/json",
}));
for await (const ev of stream.body ?? []) {
  if (ev.chunk) { console.log("llm chunk OK"); break; }
}
```

Verification checklist (record each in `VERIFICATION.md`):
- [ ] Each embedding model ID in the registry is **invocable in this account/region**.
- [ ] Titan V2's `dimensions` request field (256/512/1024) — **verify the exact request schema** and that the returned vector length equals what you put in the registry.
- [ ] The **request body shape per model family** (Titan vs Cohere embeddings differ; Anthropic messages format for generation) — verify each; this is where guessing bites.
- [ ] Streaming decode: the exact chunk envelope for the generation model (delta text location).
- [ ] Error shapes: trigger AccessDenied (wrong model), ThrottlingException — confirm your adapter maps them (§4).

**If any ID/dim/schema/region can't be verified → mark it `⚠️ VERIFY` and flag to the user. Do not hardcode a guess.**

### 1.3 Loaders

```bash
node -e "require('pdf-parse'); console.log('pdf OK')"
```

- Verify **per-page** extraction (needed for `pdf_one_per_page` provenance). `pdf-parse` gives combined text by default — confirm how to get page boundaries, or use `pdfjs-dist` page-by-page. **Flag if per-page isn't cleanly available**, since a whole strategy depends on it.
- Text loader: verify encoding fallback (`chardet` + `iconv-lite`) on a non-UTF8 file.

### 1.4 Boot without AWS

App must start and serve `/api/strategies` + `/api/models` **without** valid AWS creds (registries are static data). Only embedding/query calls require Bedrock. Verify no top-level AWS client construction crashes startup.

## 2. Build Order (bottom-up; each layer tested before the next)

Do not start a layer until the one below has passing tests.

1. **`lib/stream/events.ts`** — typed SSE event union (ingestion + query). Source of truth for both server emit and client parse.
2. **`lib/errors/errors.ts`** — error taxonomy (`NotebookNotFound`, `ModelLocked`, `StrategyNotFound`, `LoaderError`, `OversizeFile`, Bedrock access/throttle/validation/timeout) + `toReadable()` mapping. All layers import from here.
3. **`lib/chunking/types.ts`** — `ParsedElement`, `Chunk`, `StrategyConfigField`, `ChunkingStrategy`. **The contract everything orbits.**
4. **`lib/chunking/strategies/*`** — `fixed_size`, `recursive`, `delimiter`, `pdf_one_per_page`. Pure functions over `ParsedElement[]`. **Test hardest here** (§7) — deterministic chunk boundaries, overlap, provenance.
5. **`lib/chunking/registry.ts` + `factory.ts`** — registry array, `DEFAULT_STRATEGY_BY_TYPE`, factory resolving id→instance (throws `StrategyNotFound`), and config→zod compilation from `configSchema`.
6. **`lib/chunking/loaders/*`** — `Loader` interface + `text-loader`, `pdf-loader` emitting `ParsedElement[]`. Defensive (§7).
7. **`lib/models/*`** — registry (data) + factory. Unit: dims present, ids non-empty, `⚠️ VERIFY` notes carried.
8. **`lib/repositories/*`** — interfaces first, then **file impls** with `fs-util` (atomic write via temp+`rename`, per-file lock, user-scoped path builders). Test concurrent read-modify-write doesn't clobber (§7).
9. **`lib/adapters/*`** — `AuthProvider` stub, `LocalDiskUploader`, `LanceDBVectorStore` (over §1.1 verified API), `BedrockEmbeddingAdapter` + `BedrockLLMAdapter` (over §1.2 verified calls; **all AWS error mapping here**).
10. **`lib/jobs/ingestion-queue.ts`** — `IngestionQueue` interface + in-process impl (async task runner; concurrency limit; survives per-job failure).
11. **`lib/services/*`** — in order: `JobService`, `EmbeddingService` (asserts output dim == notebook.dim), `ChunkingService` (selection: explicit vs default-by-type), `IngestionService` (Template Method: parse→chunk→embed→store, emitting progress to JobService), `NotebookService` (lifecycle + model-immutability enforcement), `QueryService` (embed→search→prompt→stream).
12. **`lib/facade/notebook-facade.ts`** — wire services for each use-case; own ordering (e.g. persist `Document` as `indexed` only after vectors written).
13. **`app/api/*`** — thin routes: zod validate → `authProvider.currentUser()` → facade call → JSON or SSE. Integration-test each.
14. **Frontend** — `lib/api.ts` (typed client + SSE parse), then `notebook` switcher, `documents` table + polling, `upload` with **schema-driven** strategy controls, `chat` with citations, then polish.

**Checkpoint after step 13:** full flow via `curl`/script (create notebook → upload → poll job → query → delete doc → delete notebook) works headless before any React.

## 3. Layer Contracts (the non-negotiables)

- **Routes**: zod + auth resolve + one facade call + streaming. No LanceDB, no AWS SDK, no fs, no business logic.
- **Facade**: orchestrates services only. No direct repo/adapter/fs/AWS calls.
- **Services**: depend on repository/adapter **interfaces** (constructor-injected). No `import`from `app/`, no direct `@aws-sdk/*` or `@lancedb/*`.
- **Repositories/Adapters**: the *only* code importing `@aws-sdk/*`, `@lancedb/*`, or `fs`. All AWS error mapping lives in the Bedrock adapters.
- **Components**: consume typed DTOs from `lib/api.ts` only. Never import anything under `lib/adapters`, `lib/repositories`, or `@aws-sdk/*`.

Add an ESLint `no-restricted-imports` rule set encoding these boundaries (§5).

## 4. Bedrock Adapter Rules

- **One place per model family** for request-body construction + response/stream decode, selected by registry metadata — **no `if (modelId === …)` in services**. If Titan vs Cohere vs Anthropic differ, that difference lives in the adapter keyed by a `family`/`modality` field on the registry entry.
- **Assert embedding dim == notebook.dim on every batch** — throw a typed error on mismatch (catches a wrong-model or wrong-config bug before it corrupts the table).
- **Error mapping**: `AccessDeniedException`→"Model access not enabled / credentials lack permission"; `ThrottlingException`→"Rate limited, retry shortly"; `ValidationException`→surface message; timeouts→readable. Both request-level and in-stream.
- **Streaming abort**: the query route passes an `AbortSignal`; aborting cancels the Bedrock stream promptly (Stop button).

## 5. Layering Enforcement (make violations impossible to merge)

Add to ESLint config (`no-restricted-imports` / boundaries):

- `app/**` may import `lib/facade/**`, `lib/stream/**`, `lib/errors/**`, `lib/models/**` (types), `lib/chunking/registry` (for schemas) — **not** `lib/repositories/**`, `lib/adapters/**`, `@aws-sdk/*`, `@lancedb/*`.
- `lib/services/**` may import `lib/repositories/types`, `lib/adapters/*interface*`, `lib/chunking/**`, `lib/errors/**` — **not** `@aws-sdk/*`, `@lancedb/*`, `app/**`, `fs`.
- `lib/facade/**` may import `lib/services/**`, `lib/errors/**` — **not** repositories/adapters/AWS directly.
- `components/**` may import `lib/api`, `lib/stream/events` (types), UI libs — **not** anything under `lib/adapters`, `lib/repositories`, `@aws-sdk/*`, `@lancedb/*`.

A failing lint here = a failing build. This is how "layering holds" (an acceptance criterion) is actually guaranteed.

## 6. Prove the Strategy Extensibility Guarantee (core acceptance)

This is *the* test that validates the product's central claim.

1. Add a throwaway strategy `no_op_paragraphs` (1 chunk per paragraph) as **one class + one registry entry (+ optional default-map line)**.
2. Assert **without touching any other file**:
   - It appears in `GET /api/strategies?fileType=txt` with its `configSchema`.
   - The upload UI renders its config controls (schema-driven — no UI edit needed).
   - Server validation accepts/clamps its config (zod compiled from `configSchema`).
   - A document ingested with it produces chunks carrying its provenance.
3. `git diff --stat` for the feature must show **only** the new strategy file (+ ≤1 registry line + optional ≤1 default-map line). Any other changed file = the abstraction leaked; fix it before shipping.

Do the equivalent one-entry check for adding a **model** to the registry.

## 7. Defensive Ingestion Test Matrix (fixtures MUST all pass)

`/tests/fixtures/` + a test running loader→chunk→embed(mocked)→store per file. **A bad file fails its own document; never the batch, never the server.**

| Fixture | Expectation |
|---|---|
| `valid.txt` | indexed; chunk count > 0; provenance charStart/charEnd present |
| `valid.pdf` (multi-page) | `pdf_one_per_page` → chunk count == page count; each chunk has `metadata.page` |
| `empty.txt` (0 bytes) | `doc-error("empty document")`, not indexed |
| `whitespace.txt` | `doc-error("empty document")` |
| `latin1.txt` (non-UTF8) | decoded via fallback OR clean `doc-error` — never an uncaught decode throw |
| `corrupt.pdf` (truncated) | `doc-error` with readable reason; no crash |
| `image-only.pdf` (no text layer) | `doc-error("no extractable text")` |
| `mislabeled.txt` (binary renamed) | `doc-error`, no crash |
| `oversize.txt` (> MAX_FILE_MB) | rejected **before** parse with cap message (route-level) |
| batch `[valid.pdf, corrupt.pdf, empty.txt]` | valid indexes; others `doc-error`; each job resolves independently |

Also test **chunking strategies directly** (pure, deterministic):
- `fixed_size`: exact boundaries + overlap carry; tiny input (< size) → 1 chunk; empty → 0 chunks.
- `recursive`: respects separators, packs up to size, never exceeds size.
- `delimiter`: splits on literal/regex; `keepDelimiter` toggles inclusion; no empty chunks.
- `pdf_one_per_page`: `mergeShortPages` merges pages under `minChars`; page provenance correct.

## 8. Repository / Concurrency Verification

- **Atomic write**: `File*Repository.save` writes to `*.tmp` then `fs.rename` (atomic on same volume). Never a partial JSON on crash.
- **Concurrent update**: two `JobService.update(jobId)` calls in parallel don't lose writes (per-file lock via `proper-lockfile`/`async-mutex`). Test with `Promise.all` of N updates → final state consistent, count == N applied.
- **User scoping**: path builder refuses to resolve outside `DATA_DIR/users/{userId}/…` (guard against `..` in ids). Test a malicious `notebookId`.
- **Job progress during ingest**: worker writes progress frequently; a concurrent `GET /api/jobs/[id]` always reads a valid (atomic) snapshot.

## 9. Manual End-to-End Smoke (keep in `scripts/smoke.ts`)

```
1. POST /api/notebooks {name, embeddingModelId}         → notebookId, dim
2. POST /api/notebooks/:id/documents (valid.pdf, auto)  → 202 jobId
3. GET  /api/jobs/:jobId  (poll until job-done)          → chunks > 0
4. GET  /api/notebooks/:id                               → document indexed, totals correct
5. POST /api/notebooks/:id/query {question, topK:5}      → SSE: retrieval, text-delta*, citation* (with page), usage, done
6. POST query on a FRESH empty notebook                  → done{reason:"no_documents"}, no LLM call
7. Attempt create-doc then change embedding model        → ModelLocked error
8. DELETE /api/notebooks/:id/documents/:docId            → doc gone; re-query cannot cite it (rows deleted from table)
9. DELETE /api/notebooks/:id                             → dir + lancedb table + uploads removed from disk
```

Verify step 9 leaves **no residual** `DATA_DIR/users/{userId}/notebooks/{id}` directory.

## 10. Frontend Verification Notes

- **Schema-driven config is real**: the upload panel must render controls purely from `configSchema` returned by `/api/strategies`. Grep the components — there must be **no** per-strategy `if`/`switch` rendering. Adding a strategy shows new controls with zero UI edits (ties to §6).
- **Job progress**: poll `GET /api/jobs/[id]` (simplest) or consume the SSE stream. Handle terminal `error` gracefully (row shows reason).
- **SSE parsing** (query): single choke point that tolerates unknown event types (log + skip), never throws on a malformed frame. Mirror `lib/stream/events.ts` exactly.
- **Citations**: inline `[n]` markers map to `citation` events; expanding shows document name + **page/location from provenance** + snippet + score. Verify a PDF answer cites "p.N".
- **Stop button**: aborts the fetch; confirm the server-side Bedrock stream actually stops (not just the UI).
- **No leakage**: grep the built client bundle for `@aws-sdk`, `@lancedb`, `AWS_PROFILE` — must be absent.
- **Model-locked UX**: once a notebook has documents, the embedding-model selector is disabled with an amber explanation.

## 11. Definition of Done (per feature)

- [ ] Layering respected (ESLint boundary rules pass; §5).
- [ ] No guessed Bedrock ID/dim/schema shipped as fact — `⚠️ VERIFY` items resolved or explicitly listed to the user (§1.2).
- [ ] Embedding dim asserted against notebook.dim on every batch; no hardcoded dim anywhere.
- [ ] Defensive matrix (§7) passes; no fixture crashes server or sibling docs.
- [ ] Strategy extensibility proven by `git diff --stat` (§6) — one file (+≤2 registry lines).
- [ ] Repository atomic-write + concurrency tests pass (§8); user-path traversal blocked.
- [ ] Errors (parse, Bedrock access/throttle/validation/timeout, notebook-not-found, model-locked, oversize) render readable messages request-level AND in-stream.
- [ ] No AWS/LanceDB code in the client bundle.
- [ ] Smoke script (§9) green end-to-end, including disk cleanup on delete.

## 12. When to Stop and Ask (don't guess)

Flag to the user if:
- `@lancedb/lancedb` won't install/run on the target platform, or lacks metadata-filter / delete-by-filter on the pinned version.
- A Bedrock model ID/dim/region can't be verified in the account, or the real embedding dim disagrees with an assumption (report both numbers).
- A model family's request/stream schema differs from what the adapter expects.
- `pdf-parse` can't cleanly yield per-page text (the `pdf_one_per_page` strategy depends on it) — propose `pdfjs-dist` page iteration and confirm.
- Any layering boundary would have to be broken to make a feature work — that's a design smell; surface it rather than punching through.