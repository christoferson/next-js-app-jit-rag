// IngestionService — Template Method: parse → chunk → embed → store.
// Runs inside a queue task; ALL failures are per-document (recorded on the job +
// document), never thrown out of run(). Emits progress via JobService.
import type { DocumentRepository } from "../repositories/types";
import type { Uploader } from "../adapters/uploader";
import type { VectorStore, VectorRow } from "../adapters/vector-store";
import { getLoader } from "../chunking/loaders/registry";
import type { Chunk } from "../chunking/types";
import { ChunkingService, type ChunkingSelection } from "./chunking-service";
import { EmbeddingService } from "./embedding-service";
import { JobService } from "./job-service";
import { toReadable } from "../errors/errors";

export interface IngestionInput {
  userId: string;
  notebookId: string;
  documentId: string;
  jobId: string;
  fileType: string;
  uploadPath: string;
  embeddingModelId: string;
  dim: number;
  selection: ChunkingSelection;
}

const EMBED_BATCH = 16;

export class IngestionService {
  constructor(
    private readonly documents: DocumentRepository,
    private readonly uploader: Uploader,
    private readonly vectors: VectorStore,
    private readonly chunking: ChunkingService,
    private readonly embedding: EmbeddingService,
    private readonly jobs: JobService
  ) {}

  /** Never throws: a bad file fails its own document with a readable reason. */
  async run(input: IngestionInput): Promise<void> {
    const { userId, notebookId, documentId, jobId } = input;
    try {
      // -- parse --
      await this.setPhase(input, "parsing");
      const buffer = await this.uploader.read(input.uploadPath);
      const loader = getLoader(input.fileType);
      const elements = await loader.load(buffer, documentId);

      // -- chunk --
      await this.setPhase(input, "chunking");
      const chunks = this.chunking.chunk(input.selection, elements);
      if (chunks.length === 0) {
        await this.fail(input, "empty document (no chunks produced)");
        return;
      }

      // -- embed (replace semantics: clear any previous rows first — re-ingest support) --
      await this.setPhase(input, "embedding");
      await this.vectors.deleteByDocument(userId, notebookId, documentId);
      const rows: VectorRow[] = [];
      for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
        const batch = chunks.slice(i, i + EMBED_BATCH);
        const vectors = await this.embedding.embedDocuments(
          input.embeddingModelId,
          input.dim,
          batch.map((c) => c.text)
        );
        batch.forEach((chunk: Chunk, j: number) => {
          rows.push({
            id: `${documentId}:${chunk.ordinal}`,
            documentId,
            ordinal: chunk.ordinal,
            text: chunk.text,
            vector: vectors[j],
            metadata: { ...chunk.metadata, strategyId: input.selection.strategy.id },
          });
        });
        await this.jobs.progress(userId, jobId, "embedding", {
          processed: Math.min(i + EMBED_BATCH, chunks.length),
          total: chunks.length,
        });
      }

      // -- store --
      await this.setPhase(input, "storing");
      await this.vectors.add(userId, notebookId, input.dim, rows);

      // document flips to indexed ONLY after vectors are durably written
      await this.documents.update(userId, notebookId, documentId, (d) => ({
        ...d,
        status: "indexed",
        chunkCount: chunks.length,
        error: undefined,
      }));
      await this.jobs.completed(userId, jobId, chunks.length);
    } catch (err) {
      const { message } = toReadable(err);
      await this.fail(input, message).catch(() => {});
    }
  }

  private async setPhase(input: IngestionInput, phase: "parsing" | "chunking" | "embedding" | "storing") {
    const statusByPhase = { parsing: "parsing", chunking: "chunking", embedding: "embedding", storing: "embedding" } as const;
    await this.documents.update(input.userId, input.notebookId, input.documentId, (d) => ({
      ...d,
      status: statusByPhase[phase],
    }));
    await this.jobs.progress(input.userId, input.jobId, phase);
  }

  private async fail(input: IngestionInput, reason: string): Promise<void> {
    await this.documents
      .update(input.userId, input.notebookId, input.documentId, (d) => ({
        ...d,
        status: "error",
        error: reason,
      }))
      .catch(() => {});
    await this.jobs.failed(input.userId, input.jobId, reason);
  }
}
