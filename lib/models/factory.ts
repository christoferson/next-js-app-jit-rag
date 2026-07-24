import { EMBEDDING_MODELS, LLM_MODELS } from "./registry";
import type { EmbeddingModelConfig, LLMModelConfig } from "./types";
import { ModelNotFound } from "../errors/errors";

export function getEmbeddingModel(id: string): EmbeddingModelConfig {
  const model = EMBEDDING_MODELS.find((m) => m.id === id);
  if (!model) throw new ModelNotFound(id);
  return model;
}

export function getLLMModel(id: string): LLMModelConfig {
  const model = LLM_MODELS.find((m) => m.id === id);
  if (!model) throw new ModelNotFound(id);
  return model;
}

export function defaultLLMModel(): LLMModelConfig {
  const envId = process.env.DEFAULT_LLM_MODEL_ID;
  if (envId) {
    const found = LLM_MODELS.find((m) => m.id === envId);
    if (found) return found;
  }
  return LLM_MODELS[0];
}
