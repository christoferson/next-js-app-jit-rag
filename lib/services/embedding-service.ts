// EmbeddingService — batches over the adapter and asserts output dim == expected dim
// on EVERY batch (a wrong-model/wrong-config bug must fail loudly, never corrupt the table).
import type { EmbeddingAdapter } from "../adapters/embedding-adapter";
import { DimensionMismatch } from "../errors/errors";

export class EmbeddingService {
  constructor(private readonly adapter: EmbeddingAdapter) {}

  async embedDocuments(modelId: string, expectedDim: number, texts: string[]): Promise<number[][]> {
    const vectors = await this.adapter.embed(modelId, texts, "document");
    this.assertDim(vectors, expectedDim, modelId);
    return vectors;
  }

  async embedQuery(modelId: string, expectedDim: number, text: string): Promise<number[]> {
    const [vector] = await this.adapter.embed(modelId, [text], "query");
    this.assertDim([vector], expectedDim, modelId);
    return vector;
  }

  private assertDim(vectors: number[][], expected: number, modelId: string): void {
    for (const v of vectors) {
      if (!Array.isArray(v) || v.length !== expected) {
        throw new DimensionMismatch(expected, v?.length ?? 0, modelId);
      }
    }
  }
}
