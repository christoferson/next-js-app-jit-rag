import { NextResponse } from "next/server";
import { EMBEDDING_MODELS, LLM_MODELS } from "@/lib/models/registry";

export const runtime = "nodejs";

/** Client-safe model registry (no secrets, no SDK). */
export async function GET() {
  return NextResponse.json({
    embeddingModels: EMBEDDING_MODELS.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      dim: m.dim,
      modality: m.modality,
    })),
    llmModels: LLM_MODELS.map((m) => ({
      id: m.id,
      displayName: m.displayName,
      supportsTemperature: m.supportsTemperature,
      defaultTemperature: m.defaultTemperature,
    })),
  });
}
