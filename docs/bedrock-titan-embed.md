# Amazon Titan Text Embeddings — request/response schemas (official)

Source: https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-titan-embed-text.html (fetched 2026-07-24)

## Titan Text Embeddings V2 (`amazon.titan-embed-text-v2:0`)

### Request (body of `InvokeModel`)

```json
{
  "inputText": "string (required)",
  "dimensions": 1024,
  "normalize": true,
  "embeddingTypes": ["float"]
}
```

- `inputText` — required. Text to embed.
- `dimensions` — optional. Accepted values: **1024 (default), 512, 256**.
- `normalize` — optional. Defaults to `true`.
- `embeddingTypes` — optional. List containing `"float"`, `"binary"`, or both. Defaults to `float`.

### Response

```json
{
  "embedding": [0.1, 0.2],
  "inputTextTokenCount": 5,
  "embeddingsByType": { "float": [0.1] }
}
```

- `embedding` — float vector (absent if `embeddingTypes` contains only `binary`).
- `inputTextTokenCount` — token count of input.
- `embeddingsByType` — always present.

**Note: single text per call — no batch input.** Batch = loop/parallel InvokeModel calls.

## Titan Embeddings G1 Text (`amazon.titan-embed-text-v1`)

Request: `{ "inputText": string }` only (no inference parameters).
Response: `{ "embedding": [float...], "inputTextTokenCount": int }`.

## Verified in-account (see VERIFICATION.md)

- `amazon.titan-embed-text-v2:0` — ON_DEMAND, ACTIVE in us-east-1 (account 916902469227).
- Real dims measured by probe: see VERIFICATION.md.
