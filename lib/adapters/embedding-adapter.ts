/** EmbeddingAdapter seam. `purpose` distinguishes corpus vs query embedding
 *  (Cohere requires input_type; Titan ignores it). */
export interface EmbeddingAdapter {
  embed(modelRegistryId: string, texts: string[], purpose: "document" | "query"): Promise<number[][]>;
}
