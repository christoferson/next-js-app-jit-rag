// Bedrock embeddings. Request-body construction + response decode are keyed by the
// registry `family` field — no `if (modelId === …)` anywhere. Schemas verified against
// official docs + live probes (docs/bedrock-titan-embed.md, docs/bedrock-cohere-embed.md,
// VERIFICATION.md §1.2).
import { InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime";
import type { EmbeddingAdapter } from "./embedding-adapter";
import { bedrockClient, mapBedrockError } from "./bedrock-common";
import { getEmbeddingModel } from "../models/factory";
import { wireModelId } from "../models/registry";
import type { EmbeddingModelConfig } from "../models/types";

const dec = new TextDecoder();

async function invokeJson(modelId: string, body: unknown): Promise<Record<string, unknown>> {
  try {
    const res = await bedrockClient().send(
      new InvokeModelCommand({
        modelId,
        body: JSON.stringify(body),
        contentType: "application/json",
        accept: "application/json",
      })
    );
    return JSON.parse(dec.decode(res.body));
  } catch (err) {
    mapBedrockError(err);
  }
}

async function embedTitanV2(model: EmbeddingModelConfig, texts: string[]): Promise<number[][]> {
  // Titan is single-text per call (verified) — run the batch with bounded parallelism.
  const out: number[][] = new Array(texts.length);
  const parallel = Math.max(1, model.maxBatch);
  for (let i = 0; i < texts.length; i += parallel) {
    const slice = texts.slice(i, i + parallel);
    const vectors = await Promise.all(
      slice.map(async (text) => {
        const json = await invokeJson(wireModelId(model.id), {
          inputText: text,
          dimensions: model.dim,
          normalize: true,
        });
        return json.embedding as number[];
      })
    );
    vectors.forEach((v, j) => (out[i + j] = v));
  }
  return out;
}

async function embedTitanV1(model: EmbeddingModelConfig, texts: string[]): Promise<number[][]> {
  const out: number[][] = new Array(texts.length);
  const parallel = Math.max(1, model.maxBatch);
  for (let i = 0; i < texts.length; i += parallel) {
    const slice = texts.slice(i, i + parallel);
    const vectors = await Promise.all(
      slice.map(async (text) => {
        const json = await invokeJson(wireModelId(model.id), { inputText: text });
        return json.embedding as number[];
      })
    );
    vectors.forEach((v, j) => (out[i + j] = v));
  }
  return out;
}

async function embedCohereV3(
  model: EmbeddingModelConfig,
  texts: string[],
  purpose: "document" | "query"
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += model.maxBatch) {
    const slice = texts.slice(i, i + model.maxBatch).map((t) => t.slice(0, 2048)); // 512-token/~2048-char cap
    const json = await invokeJson(wireModelId(model.id), {
      texts: slice,
      input_type: purpose === "query" ? "search_query" : "search_document",
      truncate: "END",
    });
    out.push(...(json.embeddings as number[][]));
  }
  return out;
}

export class BedrockEmbeddingAdapter implements EmbeddingAdapter {
  async embed(modelRegistryId: string, texts: string[], purpose: "document" | "query"): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = getEmbeddingModel(modelRegistryId);
    switch (model.family) {
      case "titan-v2":
        return embedTitanV2(model, texts);
      case "titan-v1":
        return embedTitanV1(model, texts);
      case "cohere-v3":
        return embedCohereV3(model, texts, purpose);
    }
  }
}
