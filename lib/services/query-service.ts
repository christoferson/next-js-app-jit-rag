// QueryService — embed → vector search → grounded prompt → stream generation.
// Yields typed QueryEvents; the route just pipes them to SSE.
import type { VectorStore, SearchHit } from "../adapters/vector-store";
import type { LLMAdapter } from "../adapters/llm-adapter";
import type { DocumentRepository, Notebook } from "../repositories/types";
import { EmbeddingService } from "./embedding-service";
import { getLLMModel, defaultLLMModel } from "../models/factory";
import type { QueryEvent } from "../stream/events";
import { toReadable } from "../errors/errors";

export interface QueryInput {
  question: string;
  topK: number;
  documentId?: string;
  llmModelId?: string;
  temperature?: number;
  signal?: AbortSignal;
}

const SYSTEM_PROMPT = `You are a research assistant answering questions about the user's documents.
Rules:
- Answer ONLY from the numbered context blocks provided. Do not use outside knowledge.
- Cite sources inline with bracketed numbers matching the context blocks, e.g. [1] or [2][3].
- If the context does not contain the answer, say so plainly.
- Be concise and factual. Use markdown.`;

function buildPrompt(question: string, hits: SearchHit[], nameOf: (docId: string) => string): string {
  const blocks = hits
    .map((h, i) => {
      const page = typeof h.metadata.page === "number" && h.metadata.page > 0 ? ` (page ${h.metadata.page})` : "";
      return `[${i + 1}] From "${nameOf(h.documentId)}"${page}:\n${h.text}`;
    })
    .join("\n\n---\n\n");
  return `Context blocks:\n\n${blocks}\n\n---\n\nQuestion: ${question}`;
}

export class QueryService {
  constructor(
    private readonly vectors: VectorStore,
    private readonly embedding: EmbeddingService,
    private readonly llm: LLMAdapter,
    private readonly documents: DocumentRepository
  ) {}

  async *query(notebook: Notebook, input: QueryInput): AsyncGenerator<QueryEvent> {
    try {
      // empty notebook → no LLM call at all
      const docs = await this.documents.listByNotebook(notebook.userId, notebook.id);
      const indexed = docs.filter((d) => d.status === "indexed");
      if (indexed.length === 0) {
        yield { type: "done", reason: "no_documents" };
        return;
      }
      const nameById = new Map(docs.map((d) => [d.id, d.name]));

      const queryVector = await this.embedding.embedQuery(notebook.embeddingModelId, notebook.dim, input.question);
      const threshold = Number(process.env.SCORE_THRESHOLD ?? 0) || 0;
      const hits = await this.vectors.search(notebook.userId, notebook.id, queryVector, {
        topK: input.topK,
        scoreThreshold: threshold,
        documentId: input.documentId,
      });
      yield { type: "retrieval", count: hits.length };

      if (hits.length === 0) {
        yield { type: "text-delta", text: "No relevant passages were found in this notebook for that question." };
        yield { type: "done", reason: "completed" };
        return;
      }

      const model = input.llmModelId ? getLLMModel(input.llmModelId) : defaultLLMModel();
      const temperature = model.supportsTemperature
        ? Math.min(1, Math.max(0, input.temperature ?? model.defaultTemperature))
        : undefined;

      const stream = await this.llm.generateStream({
        modelId: model.id,
        system: SYSTEM_PROMPT,
        userMessage: buildPrompt(input.question, hits, (id) => nameById.get(id) ?? "unknown document"),
        temperature,
        signal: input.signal,
      });

      for await (const text of stream.deltas) {
        yield { type: "text-delta", text };
      }

      // citations for every retrieved block (UI maps [n] markers to these)
      for (let i = 0; i < hits.length; i++) {
        const h = hits[i];
        yield {
          type: "citation",
          index: i + 1,
          documentId: h.documentId,
          documentName: nameById.get(h.documentId) ?? "unknown document",
          page: typeof h.metadata.page === "number" && h.metadata.page > 0 ? h.metadata.page : undefined,
          charStart: typeof h.metadata.charStart === "number" ? h.metadata.charStart : undefined,
          charEnd: typeof h.metadata.charEnd === "number" ? h.metadata.charEnd : undefined,
          score: Number(h.score.toFixed(4)),
          snippet: h.text.length > 280 ? `${h.text.slice(0, 280)}…` : h.text,
        };
      }

      const usage = stream.usage();
      if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
        yield { type: "usage", ...usage };
      }
      yield { type: "done", reason: input.signal?.aborted ? "aborted" : "completed" };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        yield { type: "done", reason: "aborted" };
        return;
      }
      const readable = toReadable(err);
      yield { type: "error", code: readable.code, message: readable.message };
    }
  }
}
