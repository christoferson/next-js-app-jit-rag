# CLAUDE.md — Build Guide & Verification for the Ephemeral RAG Console

This is the operational companion to `SPEC.md`. It tells you (Claude Code) **what order to build in**, **what MUST be verified before you write call sites that depend on it**, and **how to prove the ephemeral guarantees actually hold**. Read `SPEC.md` first for the *what*; this file is the *how* and the *don't-guess*.

## 0. Prime Directives

1. **Never guess an API, model ID, dimension, or package capability.** If you cannot verify it (docs, a probe script, an actual import), **stop and flag it** in your output with a `⚠️ VERIFY` note. Do not write plausible-looking constants (e.g. embedding dims, model names) from memory.
2. **The ephemeral guarantee is the product.** Any code path that creates a FAISS index or temp dir MUST have a corresponding eviction path that frees it. If you can't point to where something gets freed, it's a bug.
3. **Defensive by default.** Loaders, stream adapters, and parsers must never raise uncaught into a route. Wrap, map to a readable reason, degrade.
4. **Registry, not branching.** No `if provider == "openai"` at call sites. No hardcoded `1536`. If you feel the urge, add a registry field instead.
5. **Server-only secrets.** No API keys, no embedding/LLM SDK code in the frontend bundle. The browser holds only `sessionId` + display state.

If any instruction here conflicts with `SPEC.md`, `SPEC.md` wins on *what*, this file wins on *process*.

## 1. Environment Verification (do this FIRST, before writing features)

Do not scaffold features until these pass. Record results in `/backend/VERIFICATION.md`.

### 1.1 `faiss-cpu` install (platform-sensitive — verify, don't assume)

`faiss-cpu` wheels are not uniformly available across Python versions / architectures (notably Apple Silicon and newer Python minors). **Verify before pinning.**

```bash
python -c "import faiss, numpy as np; \
idx = faiss.IndexFlatIP(384); \
v = np.random.rand(3, 384).astype('float32'); faiss.normalize_L2(v); \
idx.add(v); \
D, I = idx.search(v[:1], 2); \
print('faiss OK', faiss.__version__ if hasattr(faiss,'__version__') else 'n/a', idx.ntotal, I.tolist())"
```

- ✅ prints `faiss OK ... 3 [[...]]` → pin the working version in `requirements.txt`.
- ❌ install/import fails → record the platform + Python version, try:
  1. a different Python minor (3.11 is safest at time of writing),
  2. conda-forge `faiss-cpu` as a fallback,
  3. **flag to the user** with the exact error — do NOT substitute a different vector lib without asking.

### 1.2 SSE library

Confirm `sse-starlette`'s `EventSourceResponse` streams and that client disconnect is detectable (needed for query abort):

```bash
python -c "from sse_starlette.sse import EventSourceResponse; print('sse OK')"
```

Verify in a spike route that `await request.is_disconnected()` flips when the client aborts.

### 1.3 Loader libraries

Import-probe each and note versions:

```bash
python -c "import pypdf, docx, charset_normalizer, selectolax; print('loaders OK')"
```

- `python-docx` imports as `docx` (not `python_docx`) — verify.
- If `selectolax` won't build on the platform, fall back to `beautifulsoup4` + `lxml` and note it.

### 1.4 Provider availability probing (runtime, at startup)

Availability is **not** a guess — it's a startup probe. Build `providers/probe.py`:

- **OpenAI**: `available = bool(os.getenv("OPENAI_API_KEY"))`. Optionally a cheap live check (list models / tiny embed) behind a `PROBE_LIVE=1` flag — do **not** make live calls mandatory at startup (offline dev must work).
- **Local embeddings (`sentence-transformers`)**: attempt import; `available` only if the package imports AND the model can be resolved/downloaded (or is cached). If it would trigger a multi-hundred-MB download at startup, gate behind a config flag and mark `available: false` with reason `"model not downloaded"` until fetched.
- **Ollama**: `GET {OLLAMA_BASE_URL}/api/tags` with a short timeout; `available` only on 200 AND the target model present in the tag list.

Rules:
- A provider marked `available: false` MUST carry a human-readable `reason` surfaced via `/api/providers`.
- **Verify the exact embedding dimensions from the provider, not from memory.** For `sentence-transformers`, read `model.get_sentence_embedding_dimension()`. For OpenAI, confirm the dim from the actual embedding response length on first use and assert it matches the registry `dim` — **fail loudly on mismatch** (this is a classic silent-corruption bug).

### 1.5 `.env` wiring

Confirm the app boots with **no** provider keys set (offline mode): OpenAI models show `available: false`, local/Ollama probed. The app must not crash on startup without keys.

## 2. Build Order (bottom-up; each layer testable before the next)

Build and unit-test in this order. Do not start a layer until the one below it has passing tests.

1. **`lib/events.py`** — typed SSE event schemas (Pydantic models). Source of truth; the frontend `events.ts` mirrors this. Write these first so every stream has a contract.
2. **`lib/errors.py`** — error taxonomy + mapping (`SessionExpired`, `LoaderError`, provider auth/rate-limit/timeout) → `{code, message}`. All layers import from here.
3. **`providers/registry.py`** + **`providers/probe.py`** — seed data + availability probing. Unit test: registry has ≥1 embedding + ≥1 llm; probe degrades gracefully with no keys.
4. **`providers/validate.py`** — build request validation from registry (temperature gating/clamping, unknown model rejection, embedding-model-switch rejection). Table-test the gating.
5. **`providers/adapters/`** — thin per-provider `embed()` / `stream_generate()`. Keep them dumb; no business logic. Mock external calls in tests.
6. **`rag/loaders.py`** — per-type loaders + the defensive wrapper. **This is where most bad-input bugs live — test hardest here** (§4).
7. **`rag/chunker.py`** — deterministic chunking; test char spans + overlap + tiny/empty input.
8. **`rag/embeddings.py`** — registry-driven batched embed; asserts output dim == registry dim; L2-normalizes.
9. **`rag/index.py`** — FAISS wrapper: `build(dim)`, `add(vecs, ids)`, `search(q, k) -> (scores, rows)`. Test round-trip retrieval on known vectors.
10. **`session/store.py`** — `SessionStore`, `DocStore`, `FileRecord`. Test DocStore row↔metadata mapping.
11. **`session/manager.py`** — create/get/touch/evict/reap + locks + reaper task. **Test TTL + eviction here** (§5) before any route touches it.
12. **`rag/generate.py`** — prompt build (numbered context, grounding instruction) + streaming adapter emitting typed events. Test citation emission maps to real retrieved chunks.
13. **`api/*` routes** — validation + wiring + SSE only. Integration-test each endpoint.
14. **`app.py`** — lifespan (start reaper on startup, `evict-all` on shutdown), CORS for the frontend origin, route mounting.
15. **Frontend** — `lib/api.ts` + `events.ts` + `useSession.ts` first (bootstrap/heartbeat/410 handling), then `session/`, `upload/`, `chat/` components, then polish.

**Checkpoint after step 14:** you should be able to `curl` the full flow (create → upload → query → delete) before writing a single React component.

## 3. Layer Contracts (the non-negotiables)

- **Routes** contain no FAISS, no provider SDK calls beyond invoking `rag/*`. Just Pydantic validation, `manager.get()`, `manager.touch()`, and streaming.
- **`rag/*`** imports no FastAPI. Pure-ish; takes data, returns data or yields events.
- **`session/*`** is the **only** place that constructs or destroys a FAISS index or a temp dir. If index creation appears anywhere else, that's a defect.
- **Every successful route** calls `manager.touch(session_id)` and returns/streams the fresh `expiresAt`.
- **Every route that resolves a session** calls `manager.get()`, which raises `SessionExpired` → mapped to **HTTP 410** with `{code: "session_expired"}`. No auto-recreate.

## 4. Defensive Ingestion Test Matrix (build these fixtures; they MUST all pass)

Create `/backend/tests/fixtures/` and a test that runs the full loader→chunk→embed path per file. **The server must survive every one of these; bad files fail per-file, never crash the batch.**

| Fixture | Expectation |
|---|---|
| `valid.pdf` (text-based) | indexed, chunk_count > 0 |
| `scanned.pdf` (images, no text layer) | `file-error("no extractable text")`, batch continues |
| `encrypted.pdf` | `file-error` with readable reason, no crash |
| `empty.txt` (0 bytes) | `file-error("empty document")` |
| `whitespace.txt` (only spaces/newlines) | `file-error("empty document")` |
| `latin1.txt` (non-UTF8 encoding) | decoded via fallback OR clean `file-error`, never a `UnicodeDecodeError` to the route |
| `mislabeled.pdf` (actually a PNG renamed) | rejected per-file with reason |
| `huge.txt` (> MAX_FILE_MB) | rejected **before** parsing with cap message |
| `valid.docx`, `valid.md`, `valid.csv`, `valid.html` | indexed |
| `corrupt.docx` (truncated zip) | `file-error`, no crash |
| batch of `[valid.pdf, corrupt.docx, empty.txt]` | valid.pdf indexes; other two emit `file-error`; `ingest-done` still fires |

Also assert: uploading a batch that would exceed `MAX_SESSION_MB` / `MAX_SESSION_CHUNKS` is rejected with the existing index **untouched** (no partial corruption).

## 5. Ephemeral-Guarantee Verification (the core acceptance proof)

These are the tests that prove the product's central promise. Write them explicitly.

### 5.1 Idle eviction (unit, time-mocked)

- Set `ttl_seconds` small; create a session, add vectors, note `temp_dir`.
- Advance mocked clock past TTL; run `manager.reap()`.
- Assert: session id no longer in `manager.sessions`; `manager.get(id)` raises `SessionExpired`; `temp_dir` no longer exists on disk; the log line records `reason=idle` and `freed_vectors > 0`.

### 5.2 Activity refresh

- Create session; advance clock to `ttl - 1s`; call `touch()`; advance another `ttl - 1s`; run `reap()`.
- Assert: session **survives** (touch reset the timer). Then advance past TTL without touching; `reap()` evicts.

### 5.3 Explicit + beacon teardown

- `DELETE /api/session` on a live session → `{ended: true}`, temp_dir gone, index freed.
- `DELETE` on an unknown/already-evicted id → `{ended: false}`, **HTTP 200, never 5xx**.

### 5.4 Shutdown eviction

- Create N sessions; trigger the lifespan shutdown hook.
- Assert: all temp dirs deleted; `manager.sessions` empty.

### 5.5 No-persistence proof (integration)

- Create session, upload, confirm vectors > 0. Kill and restart the backend process.
- Assert: `GET /api/session/status?sessionId=<old>` → **410**; `manager.sessions` is empty; no session temp dirs remain on disk.

### 5.6 Temp-dir leak audit (recipe)

Run this manually and in CI-lite:

```bash
# 1. note baseline
ls -la $TMPDIR | grep -c ragsess || true
# 2. create + upload via curl (script below), then end session
# 3. re-count — MUST return to baseline
ls -la $TMPDIR | grep -c ragsess || true
```

Use a recognizable temp-dir prefix (e.g. `ragsess-<uuid>`) so leaks are greppable. **Any residual `ragsess-*` dir after eviction is a failing test.**

### 5.7 Concurrency

- Fire a query and an upload against the same session concurrently (asyncio tasks).
- Assert: no index corruption (search results remain valid, `index.ntotal` consistent), thanks to the per-session lock.

## 6. Manual End-to-End Smoke (curl)

Keep this in `/backend/scripts/smoke.sh`. It should pass before frontend work.

```bash
BASE=http://localhost:8000

# create
SID=$(curl -s -X POST $BASE/api/session | tee /dev/stderr | python -c "import sys,json;print(json.load(sys.stdin)['sessionId'])")

# upload (SSE — watch for file-indexed + ingest-done)
curl -N -X POST $BASE/api/upload -F "sessionId=$SID" -F "files=@tests/fixtures/valid.pdf"

# status (expect files[], totals, expiresAt)
curl -s "$BASE/api/session/status?sessionId=$SID" | python -m json.tool

# query (SSE — expect retrieval, text-delta*, citation*, done)
curl -N -X POST $BASE/api/query -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"question\":\"summarize the document\",\"topK\":4}"

# empty-index query on a fresh session → immediate 'done' with no-documents notice
SID2=$(curl -s -X POST $BASE/api/session | python -c "import sys,json;print(json.load(sys.stdin)['sessionId'])")
curl -N -X POST $BASE/api/query -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID2\",\"question\":\"anything\"}"

# end
curl -s -X DELETE $BASE/api/session -H 'content-type: application/json' -d "{\"sessionId\":\"$SID\"}"

# expired → 410
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/session/status?sessionId=$SID"   # expect 410
```

## 7. Frontend Verification Notes

- **`useSession.ts`** is the linchpin: bootstrap on mount, heartbeat only while `document.visibilityState === "visible"`, and a **single** place that catches `410` → shows the expired interstitial. Every API call funnels through `lib/api.ts` so 410 handling isn't scattered.
- **sendBeacon on unload**: verify it actually fires (`DELETE` with a keepalive/beacon-compatible body). `fetch(..., {keepalive:true})` is the fallback; test both in a real browser, not just unit.
- **Countdown authority**: the timer counts toward the server's `expiresAt`, and every successful response updates it. Never compute expiry purely client-side — the server is the source of truth.
- **SSE parsing**: tolerate unknown event types (log + skip); never throw on a malformed frame. Mirror the server event union exactly in `events.ts`.
- **No leakage into the bundle**: grep the built client for provider SDK names / `OPENAI_API_KEY`. Must be absent.

## 8. Definition of Done (per feature, before you call it complete)

- [ ] Every new FAISS index / temp dir has a proven eviction path (point to the test).
- [ ] No hardcoded embedding dim, model id, or `if provider ==` at a call site.
- [ ] The bad-input matrix (§4) passes; no fixture crashes the server.
- [ ] The ephemeral tests (§5) pass, including the temp-dir leak audit and no-persistence-after-restart proof.
- [ ] Provider unavailability (no keys / Ollama down) degrades gracefully with a surfaced reason — app still boots and serves `/api/providers`.
- [ ] Errors (parse, provider auth/rate-limit/timeout, expired session) render readable messages both at request-level and in-stream.
- [ ] Adding a model was (or would be) a **one-entry** registry change — confirm by actually adding a throwaway entry and seeing it appear in `/api/providers` with no other edits.
- [ ] `⚠️ VERIFY` items are either resolved or explicitly listed for the user. **Nothing guessed shipped as fact.**

## 9. When to Stop and Ask

Flag to the user (don't guess) if:

- `faiss-cpu` won't install on the target platform after the fallbacks in §1.1.
- An embedding model's real dimension disagrees with what you'd have assumed (report both).
- A provider SDK's streaming interface differs from what the adapter expects.
- Any ephemeral-guarantee test can't be made to pass (a leak you can't close) — this is a product-defining failure, not a detail.