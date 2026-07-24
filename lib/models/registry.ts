// Model Registry — adding a model = ONE entry here. All values below were
// VERIFIED against account 916902469227 / us-east-1 on 2026-07-24 by probe
// (scripts/verify-bedrock.mts); dims are MEASURED, not assumed. See VERIFICATION.md.
import type { EmbeddingModelConfig, LLMModelConfig } from "./types";

export const EMBEDDING_MODELS: EmbeddingModelConfig[] = [
  {
    id: "amazon.titan-embed-text-v2:0",
    displayName: "Titan Text Embeddings V2 (1024)",
    family: "titan-v2",
    dim: 1024, // measured: request dimensions=1024 → 1024 floats
    maxBatch: 8, // Titan is single-text per InvokeModel; adapter parallelizes up to this
    modality: "text",
    notes: ["verified 2026-07-24: on-demand, real dim 1024"],
  },
  {
    id: "amazon.titan-embed-text-v2:0@512",
    displayName: "Titan Text Embeddings V2 (512)",
    family: "titan-v2",
    dim: 512, // measured: request dimensions=512 → 512 floats
    maxBatch: 8,
    modality: "text",
    notes: ["verified 2026-07-24: on-demand, real dim 512", "same model, dimensions=512 request field"],
  },
  {
    id: "cohere.embed-english-v3",
    displayName: "Cohere Embed English v3",
    family: "cohere-v3",
    dim: 1024, // measured: 1024 floats
    maxBatch: 96, // per Cohere/Bedrock docs (docs/bedrock-cohere-embed.md)
    modality: "text",
    notes: ["verified 2026-07-24: on-demand, real dim 1024, batch input supported"],
  },
];

export const LLM_MODELS: LLMModelConfig[] = [
  {
    id: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    displayName: "Claude Sonnet 4.5",
    family: "anthropic-messages",
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    supportsTemperature: true, // verified: temperature=0.2 accepted (do NOT also send top_p)
    defaultTemperature: 0.2,
    notes: ["verified 2026-07-24: inference profile, streaming OK"],
  },
  {
    id: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    displayName: "Claude Haiku 4.5",
    family: "anthropic-messages",
    contextWindow: 200_000,
    maxOutputTokens: 8192,
    supportsTemperature: true,
    defaultTemperature: 0.2,
    notes: ["verified 2026-07-24: inference profile, streaming OK"],
  },
];

/**
 * Registry-ID convention: an entry id may carry a `@<dims>` suffix to select a
 * request-time dimension variant of the same Bedrock model (Titan V2 supports
 * 256/512/1024). The adapter strips the suffix for the wire modelId and sends
 * the `dimensions` field from `dim`.
 */
export function wireModelId(registryId: string): string {
  return registryId.split("@")[0];
}
