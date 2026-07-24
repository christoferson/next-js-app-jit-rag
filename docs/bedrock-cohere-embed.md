# Cohere Embed v3 on Bedrock — request/response schemas (official)

Source: https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-embed-v3.html (fetched 2026-07-24)

Model IDs (on-demand in us-east-1, account 916902469227):
- `cohere.embed-english-v3`
- `cohere.embed-multilingual-v3`
- (`cohere.embed-v4:0` also ACTIVE/ON_DEMAND — schema differs, see model-parameters-embed-v4 if adopted)

Streaming NOT supported for embed models.

## Request (body of `InvokeModel`)

```json
{
  "texts": ["string", "..."],
  "input_type": "search_document",
  "truncate": "END",
  "embedding_types": ["float"]
}
```

- `texts` — required. Array of strings. Each text max **512 tokens (~2048 chars)**. Batch limit: per-call texts limit applies (96 per Cohere docs — verify if pushing large batches).
- `input_type` — required. `search_document` (index corpus) | `search_query` (query) | `classification` | `clustering` | `image`.
  - RAG pattern: embed chunks with `search_document`, embed the user question with `search_query`.
- `truncate` — optional. `NONE` (error on overflow) | `START` | `END` (default).
- `embedding_types` — optional; default None → `embeddings_floats` response type.

## Response (default float response)

```json
{
  "embeddings": [[0.1, 0.2]],
  "id": "string",
  "response_type": "embeddings_floats",
  "texts": ["..."]
}
```

- `embeddings` — array of 1024-float vectors, same order/length as `texts`.
- If `embedding_types` was specified, `embeddings` is instead a map keyed by type (e.g. `embeddings.float`).

## Verified in-account

Real dims + response shape measured by probe: see VERIFICATION.md.
