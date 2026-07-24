// Probes the ACTUAL account/region for:
// - Titan V2 embeddings: id invocable, dimensions field honored (256/512/1024), real dims
// - Titan G1 embeddings: id invocable, real dim
// - Cohere embed v3: id invocable, batch texts, real dim, input_type
// - Anthropic Messages via inference profile: streaming envelope (event types, delta location)
// - Error shapes: AccessDenied/Validation on a bogus model id
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
} from "@aws-sdk/client-bedrock-runtime";

const region = process.env.AWS_REGION ?? "us-east-1";
const client = new BedrockRuntimeClient({ region });
const dec = new TextDecoder();

async function invoke(modelId: string, body: unknown) {
  const res = await client.send(
    new InvokeModelCommand({
      modelId,
      body: JSON.stringify(body),
      contentType: "application/json",
      accept: "application/json",
    })
  );
  return JSON.parse(dec.decode(res.body));
}

// ---- Titan V2 ----
for (const dims of [256, 512, 1024]) {
  const r = await invoke("amazon.titan-embed-text-v2:0", {
    inputText: "hello world",
    dimensions: dims,
    normalize: true,
  });
  console.log(`titan-v2 dims=${dims} → REAL dim=${r.embedding?.length}, tokens=${r.inputTextTokenCount}`);
}
// default (no dimensions field)
const tDef = await invoke("amazon.titan-embed-text-v2:0", { inputText: "hello world" });
console.log(`titan-v2 default → REAL dim=${tDef.embedding?.length}`);

// ---- Titan G1 v1 ----
try {
  const g1 = await invoke("amazon.titan-embed-text-v1", { inputText: "hello world" });
  console.log(`titan-v1 → REAL dim=${g1.embedding?.length}`);
} catch (e: any) {
  console.log(`titan-v1 FAILED: ${e.name}: ${e.message}`);
}

// ---- Cohere embed v3 ----
try {
  const c = await invoke("cohere.embed-english-v3", {
    texts: ["hello world", "second text"],
    input_type: "search_document",
    truncate: "END",
  });
  console.log(
    `cohere-en-v3 → count=${c.embeddings?.length}, REAL dim=${c.embeddings?.[0]?.length}, response_type=${c.response_type}`
  );
} catch (e: any) {
  console.log(`cohere-en-v3 FAILED: ${e.name}: ${e.message}`);
}

// ---- Anthropic streaming via inference profile ----
const llmId = process.env.VERIFY_LLM_ID ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0";
try {
  const stream = await client.send(
    new InvokeModelWithResponseStreamCommand({
      modelId: llmId,
      body: JSON.stringify({
        anthropic_version: "bedrock-2023-05-31",
        max_tokens: 64,
        temperature: 0.2,
        system: "You are terse.",
        messages: [{ role: "user", content: [{ type: "text", text: "Say hi in three words." }] }],
      }),
      contentType: "application/json",
      accept: "application/json",
    })
  );
  const seen: string[] = [];
  let text = "";
  let usage: unknown = null;
  let metrics: unknown = null;
  for await (const ev of stream.body ?? []) {
    if (!ev.chunk?.bytes) { console.log("non-chunk event:", Object.keys(ev)); continue; }
    const j = JSON.parse(dec.decode(ev.chunk.bytes));
    if (!seen.includes(j.type)) seen.push(j.type);
    if (j.type === "content_block_delta") text += j.delta?.text ?? "";
    if (j.type === "message_delta") usage = j.usage;
    if (j.type === "message_stop") metrics = j["amazon-bedrock-invocationMetrics"];
  }
  console.log(`llm ${llmId}`);
  console.log(`  event order: ${seen.join(" → ")}`);
  console.log(`  text: ${JSON.stringify(text)}`);
  console.log(`  message_delta.usage: ${JSON.stringify(usage)}`);
  console.log(`  invocationMetrics: ${JSON.stringify(metrics)}`);
} catch (e: any) {
  console.log(`llm ${llmId} FAILED: ${e.name}: ${e.message}`);
}

// ---- Error shapes ----
try {
  await invoke("amazon.titan-embed-text-v9:0", { inputText: "x" });
} catch (e: any) {
  console.log(`bogus-model error → name=${e.name}, $fault=${e.$fault}, status=${e.$metadata?.httpStatusCode}, msg=${e.message}`);
}
try {
  // bare model id for an INFERENCE_PROFILE-only model — expect ValidationException
  await invoke("anthropic.claude-sonnet-4-5-20250929-v1:0", {
    anthropic_version: "bedrock-2023-05-31",
    max_tokens: 8,
    messages: [{ role: "user", content: "hi" }],
  });
  console.log("bare-claude-id unexpectedly SUCCEEDED");
} catch (e: any) {
  console.log(`bare-claude-id error → name=${e.name}, msg=${e.message}`);
}

console.log("BEDROCK VERIFY: DONE");
