/** LLMAdapter seam — streaming grounded generation. */
export interface LLMStreamHandle {
  /** async iterator of text deltas */
  deltas: AsyncIterable<string>;
  /** resolves after the stream ends with usage (if the provider reported it) */
  usage(): { inputTokens?: number; outputTokens?: number };
}

export interface GenerateOptions {
  modelId: string;
  system: string;
  userMessage: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export interface LLMAdapter {
  generateStream(options: GenerateOptions): Promise<LLMStreamHandle>;
}
