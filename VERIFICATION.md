# VERIFICATION.md — Environment Verification Results

Per CLAUDE.md §1. All probes run on 2026-07-24 against the real environment. Probe scripts live in `scripts/verify-*.mts` (rerunnable with `npx tsx`).

**Environment**: Windows 10 Home 10.0.19045 (win32 x64), Node v22.14.0, npm 11.11.0.
**AWS**: account `916902469227` (IAM user `admin`), region `us-east-1`, profile `b2b-sandbox-admin` (via `AWS_PROFILE`).

## 1.1 LanceDB — ✅ PASS

- Package: `@lancedb/lancedb@^0.31.0` — prebuilt binary loads on win32/x64/Node 22.
- Probe: `scripts/verify-lancedb.mts` → `LANCEDB VERIFY: ALL PASS`.

| Capability | API verified | Result |
|---|---|---|
| Connect + create table | `lancedb.connect(dir)`, `db.createTable(name, rows, { mode: "overwrite" })` | ✅ |
| Vector search + limit | `tbl.search(vec).limit(n).toArray()` | ✅ returns `_distance` field |
| Metadata roundtrip | arbitrary row fields (`documentId`, `page`, `text`) | ✅ preserved |
| Metadata filter | `tbl.search(vec).where("documentId = 'doc2'")` | ✅ filters correctly |
| Delete-by-filter | `tbl.delete("documentId = 'doc1'")` | ✅ rows removed |
| Reopen / count / drop | `db.openTable`, `tbl.countRows()`, `db.dropTable`, `db.tableNames()` | ✅ |

**Pinned**: `@lancedb/lancedb 0.31.x`.

## 1.2 Bedrock — ✅ PASS (real account probes, no guessed values)

Probe: `scripts/verify-bedrock.mts`. Model availability enumerated with `scripts/list-bedrock-models.mts` + `scripts/list-inference-profiles.mts`.

### Embedding models (ON_DEMAND, invocable, dims MEASURED)

| Model ID | Request `dimensions` | REAL measured dim | Notes |
|---|---|---|---|
| `amazon.titan-embed-text-v2:0` | 256 | **256** | ✅ |
| `amazon.titan-embed-text-v2:0` | 512 | **512** | ✅ |
| `amazon.titan-embed-text-v2:0` | 1024 (also default when omitted) | **1024** | ✅ registry default |
| `amazon.titan-embed-text-v1` | n/a (no params) | **1536** | ✅ |
| `cohere.embed-english-v3` | n/a (fixed) | **1024** | ✅ batch of 2 texts → 2 vectors, `response_type=embeddings_floats` |

- Titan V2 request schema verified: `{ inputText, dimensions?, normalize?, embeddingTypes? }`; response `{ embedding, inputTextTokenCount, embeddingsByType }`. **Single text per call** (no batch field) → EmbeddingService batches via parallel calls.
- Cohere v3 request schema verified: `{ texts[], input_type, truncate?, embedding_types? }`; response `{ embeddings[][], id, response_type, texts }`. `input_type`: `search_document` for chunks, `search_query` for queries. Max 512 tokens/text (~2048 chars); Cohere docs cap texts-per-call at 96.
- Official schema docs saved: `docs/bedrock-titan-embed.md`, `docs/bedrock-cohere-embed.md`.

### Generation LLMs (streaming, invocable)

⚠️ **All current Anthropic text models in this account are `INFERENCE_PROFILE`-only.** Bare `anthropic.…` IDs are rejected: probe confirmed
`ValidationException: Invocation of model ID anthropic.claude-sonnet-4-5-20250929-v1:0 with on-demand throughput isn't supported…`.
The registry therefore uses **inference-profile IDs** (`us.anthropic.…`).

| Inference profile ID | Streamed OK | Verified |
|---|---|---|
| `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | ✅ text + usage + metrics | ✅ |
| `us.anthropic.claude-haiku-4-5-20251001-v1:0` | ✅ text + usage + metrics | ✅ |

- The SPEC's suggested `anthropic.claude-3-5-sonnet-20240620-v1:0` is **not available** in this account (not in `ListFoundationModels` results) — replaced with the verified profiles above. `.env.local.example` default updated accordingly.
- Request schema verified (Messages API): `anthropic_version: "bedrock-2023-05-31"` (required), `max_tokens` (required), `system?`, `messages[]`, `temperature?` (0–1). ⚠️ Sonnet 4.5/Haiku 4.5: set `temperature` **or** `top_p`, never both.
- Streaming envelope MEASURED: events arrive as `{ chunk: { bytes } }` → JSON with order
  `message_start → content_block_start → content_block_delta* → content_block_stop → message_delta → message_stop`.
  Text deltas: `content_block_delta.delta.text` (`type: "text_delta"`). Usage: `message_delta.usage.{input_tokens,output_tokens}`. Metrics: `message_stop["amazon-bedrock-invocationMetrics"]`.
- Docs saved: `docs/bedrock-anthropic-messages.md`.

### Error shapes (triggered on purpose)

| Trigger | Result |
|---|---|
| Invalid model id | `ValidationException` ($fault=client, HTTP 400) "The provided model identifier is invalid." |
| Bare Claude id (profile-only) | `ValidationException` with readable retry-with-profile message |
| AccessDenied / Throttling | Not triggerable on demand in this account (admin creds; no throttle hit). Adapter maps by error `name` — `AccessDeniedException`, `ThrottlingException`, `ValidationException`, `ModelTimeoutException` — per official SDK error types. |

## 1.3 Loaders — ✅ PASS

Probe: `scripts/verify-loaders.mts`.

- **PDF per-page**: chose `pdfjs-dist@^6` (legacy build `pdfjs-dist/legacy/build/pdf.mjs` for Node) over `pdf-parse`, because pdf-parse concatenates text and per-page provenance is required by `pdf_one_per_page`. Verified: 2-page PDF → `doc.numPages=2`, `page.getTextContent()` yields correct per-page text. Options for Node: `{ data: Uint8Array, useWorkerFetch: false, isEvalSupported: false, standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }`.
- **Corrupt PDF**: truncated file → catchable `InvalidPDFException` ("Invalid PDF structure.") — clean per-document error, no crash.
- **Encoding fallback**: `chardet` detected latin1 bytes as ISO-8859-2 (close superset); `iconv-lite` decoded without throwing (accented chars mostly correct — acceptable fallback per CLAUDE.md; never an uncaught decode throw).

## 1.4 Boot without AWS — ✅ PASS

Production build (`next start`, port 3002) with `AWS_PROFILE`/`AWS_REGION`/key env vars stripped:
`/api/models` → 200, `/api/strategies?fileType=txt` → 200, `/api/notebooks` → 200 (fs-only). Bedrock clients are constructed lazily in `lib/adapters/bedrock-common.ts`; nothing AWS runs at module load.

## Acceptance results (2026-07-24)

| Check | Result |
|---|---|
| Unit tests (strategies, factory/zod, loaders, repositories/concurrency) | ✅ 57/57 pass (`npx vitest run`) |
| API smoke §9, steps 1–9 incl. ModelLocked 409 + disk cleanup | ✅ `scripts/smoke.mts` ALL PASS (real Bedrock) |
| Defensive matrix §7 via API (batch of 7 hostile fixtures + oversize 413) | ✅ `scripts/defensive-matrix.mts` ALL PASS |
| Strategy extensibility §6 (`no_op_paragraphs`) | ✅ diff = 1 new file + 2 registry lines; appeared in `/api/strategies`, config clamped (-5→1) & stripped (`evil` removed), ingested with provenance; reverted after proof (`scripts/ext-proof.mts`) |
| Layering boundaries §5 (ESLint `no-restricted-imports` per layer) | ✅ `npm run lint` clean; violations are build failures |
| Client bundle leakage | ✅ `grep -rl "@aws-sdk\|@lancedb\|AWS_PROFILE" .next/static/` → no matches |
| Production build | ✅ `npm run build` clean (Turbopack; `serverExternalPackages: ["@lancedb/lancedb", "pdfjs-dist"]` required for the native module) |
| UI end-to-end (headless Chromium) | ✅ `scripts/ui-smoke.mts` — create → upload (custom schema-driven config) → indexed → query → expandable citation with `p.N` → delete; zero console errors; screenshots in `.verify/ui/` |

Known notes:
- Port 3000 was occupied by an unrelated process on this machine during verification; dev server ran on 3001.
- `toReadable` uses a structural `isAppError` check instead of `instanceof` — under Turbopack dev, the route bundle and the globalThis-cached container can hold different class identities for the same error class.
