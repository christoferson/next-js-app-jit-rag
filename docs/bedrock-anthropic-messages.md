# Anthropic Claude Messages API on Bedrock — request/response + streaming (official)

Sources (fetched 2026-07-24):
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages.html
- https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-anthropic-claude-messages-request-response.html

## Model invocation requirement (account-verified)

All current Claude text models in this account are `inference: ["INFERENCE_PROFILE"]` — they **cannot** be invoked by bare model ID (`anthropic.claude-...`). You MUST use an inference-profile ID, e.g. `us.anthropic.claude-sonnet-4-5-20250929-v1:0`. Verified list: see VERIFICATION.md.

## Request (body of `InvokeModel` / `InvokeModelWithResponseStream`)

```json
{
  "anthropic_version": "bedrock-2023-05-31",
  "max_tokens": 1024,
  "system": "optional system prompt (string or [{type:'text',text}])",
  "messages": [
    { "role": "user", "content": [{ "type": "text", "text": "Hello" }] }
  ],
  "temperature": 0.2,
  "top_p": 0.9,
  "top_k": 250,
  "stop_sequences": ["\n\nHuman:"]
}
```

- `anthropic_version` — **required**, must be `"bedrock-2023-05-31"`.
- `max_tokens` — **required**.
- `messages` — required; roles alternate `user`/`assistant`; `content` is string shorthand or array of typed blocks.
- `system`, `temperature` (0–1), `top_p`, `top_k`, `stop_sequences` — optional.
- ⚠️ Claude Sonnet 4.5 / Haiku 4.5 (and newer): specify **either** `temperature` **or** `top_p`, not both.

## Non-streaming response

```json
{
  "id": "...", "model": "...", "type": "message", "role": "assistant",
  "content": [{ "type": "text", "text": "..." }],
  "stop_reason": "end_turn | max_tokens | stop_sequence | tool_use | refusal | model_context_window_exceeded",
  "stop_sequence": null,
  "usage": { "input_tokens": 10, "output_tokens": 25 }
}
```

## Streaming (`InvokeModelWithResponseStream`)

Each SDK event is `{ chunk: { bytes: Uint8Array } }`; decode bytes → JSON. Event sequence
(verified by probe — see VERIFICATION.md):

1. `message_start` — `{ type, message: { id, role, usage: { input_tokens, ... } } }`
2. `content_block_start` — `{ type, index, content_block: { type: "text", text: "" } }`
3. `content_block_delta`* — `{ type, index, delta: { type: "text_delta", text: "..." } }` ← **text lives here**
4. `content_block_stop`
5. `message_delta` — `{ type, delta: { stop_reason, stop_sequence }, usage: { output_tokens } }`
6. `message_stop` — `{ type, "amazon-bedrock-invocationMetrics": { inputTokenCount, outputTokenCount, invocationLatency, firstByteLatency } }`

Refusals can arrive mid-stream as the final `message_delta` with `stop_reason: "refusal"`; earlier streamed content is valid partial output. Branch on `stop_reason`, not `stop_details`.

## Error types (from `@aws-sdk/client-bedrock-runtime`)

- `AccessDeniedException` — model access not enabled / IAM lacks permission.
- `ThrottlingException` — rate limited.
- `ValidationException` — bad body/model id (e.g. invoking an INFERENCE_PROFILE-only model by bare id).
- `ResourceNotFoundException`, `ModelTimeoutException`, `ModelNotReadyException`, `ServiceQuotaExceededException`.
- Streams can also carry in-stream errors: `internalServerException`, `modelStreamErrorException`, `validationException`, `throttlingException` fields on the event union.
