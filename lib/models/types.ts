// Bedrock model registry types (SPEC §6.1). `family` keys the adapter's
// request-body construction — no `if (modelId === …)` anywhere else.

export type EmbeddingFamily = "titan-v2" | "titan-v1" | "cohere-v3";
export type LLMFamily = "anthropic-messages";

export interface EmbeddingModelConfig {
  id: string; // e.g. "amazon.titan-embed-text-v2:0"
  displayName: string;
  family: EmbeddingFamily;
  /** FIXES the notebook's LanceDB vector dimension */
  dim: number;
  /** max texts per adapter batch call */
  maxBatch: number;
  modality: "text"; // 'multimodal' reserved (seam)
  notes?: string[]; // verification status
}

export interface LLMModelConfig {
  id: string; // inference-profile id, e.g. "us.anthropic.claude-sonnet-4-5-…"
  displayName: string;
  family: LLMFamily;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTemperature: boolean;
  defaultTemperature: number;
  notes?: string[];
}
