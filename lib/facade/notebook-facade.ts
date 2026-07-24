// NotebookFacade — the single coarse use-case API the routes call.
// Orchestrates services only; owns cross-service ordering.
import { randomUUID } from "node:crypto";
import type { DocumentEntity, Job, Notebook } from "../repositories/types";
import type { DocumentRepository } from "../repositories/types";
import type { Uploader } from "../adapters/uploader";
import type { VectorStore } from "../adapters/vector-store";
import type { IngestionQueue } from "../jobs/ingestion-queue";
import { NotebookService } from "../services/notebook-service";
import { IngestionService } from "../services/ingestion-service";
import { ChunkingService } from "../services/chunking-service";
import { JobService, type JobObserver } from "../services/job-service";
import { QueryService, type QueryInput } from "../services/query-service";
import { DocumentNotFound, OversizeFile, UnsupportedFileType } from "../errors/errors";
import { SUPPORTED_FILE_TYPES } from "../chunking/loaders/registry";
import { getEmbeddingModel, defaultLLMModel } from "../models/factory";
import type { QueryEvent } from "../stream/events";

export interface UploadRequest {
  fileName: string;
  data: Buffer;
  chunkingMode: "auto" | "custom";
  strategyId?: string;
  strategyConfig?: unknown;
}

export interface NotebookOverview {
  notebook: Notebook;
  documents: DocumentEntity[];
  totals: { documents: number; chunks: number };
  embeddingModel: { id: string; displayName: string; dim: number };
  llmDefault: { id: string; displayName: string };
}

function fileTypeOf(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return ext;
}

export class NotebookFacade {
  constructor(
    private readonly notebookService: NotebookService,
    private readonly ingestionService: IngestionService,
    private readonly chunkingService: ChunkingService,
    private readonly jobService: JobService,
    private readonly queryService: QueryService,
    private readonly documents: DocumentRepository,
    private readonly uploader: Uploader,
    private readonly vectors: VectorStore,
    private readonly queue: IngestionQueue
  ) {}

  // ---- notebooks ----

  createNotebook(userId: string, name: string, embeddingModelId: string): Promise<Notebook> {
    return this.notebookService.create(userId, name, embeddingModelId);
  }

  listNotebooks(userId: string) {
    return this.notebookService.list(userId);
  }

  async openNotebook(userId: string, notebookId: string): Promise<NotebookOverview> {
    const notebook = await this.notebookService.get(userId, notebookId);
    const documents = await this.documents.listByNotebook(userId, notebookId);
    const model = getEmbeddingModel(notebook.embeddingModelId);
    const llm = defaultLLMModel();
    return {
      notebook,
      documents,
      totals: {
        documents: documents.length,
        chunks: documents.reduce((sum, d) => sum + (d.chunkCount ?? 0), 0),
      },
      embeddingModel: { id: model.id, displayName: model.displayName, dim: model.dim },
      llmDefault: { id: llm.id, displayName: llm.displayName },
    };
  }

  updateNotebook(
    userId: string,
    notebookId: string,
    patch: { name?: string; embeddingModelId?: string }
  ): Promise<Notebook> {
    return this.notebookService.update(userId, notebookId, patch);
  }

  deleteNotebook(userId: string, notebookId: string): Promise<void> {
    return this.notebookService.delete(userId, notebookId);
  }

  // ---- documents & ingestion ----

  async ingestDocument(
    userId: string,
    notebookId: string,
    upload: UploadRequest
  ): Promise<{ jobId: string; documentId: string }> {
    const notebook = await this.notebookService.get(userId, notebookId); // 404 first
    const maxMb = Number(process.env.MAX_FILE_MB ?? 50) || 50;
    if (upload.data.length > maxMb * 1024 * 1024) throw new OversizeFile(upload.data.length, maxMb);

    const fileType = fileTypeOf(upload.fileName);
    if (!SUPPORTED_FILE_TYPES.includes(fileType)) throw new UnsupportedFileType(fileType);

    // strategy selection + config validation happen BEFORE the job is queued (fail fast, 400)
    const selection = this.chunkingService.select(
      fileType,
      upload.chunkingMode,
      upload.strategyId,
      upload.strategyConfig
    );

    const documentId = `doc_${randomUUID()}`;
    const jobId = `job_${randomUUID()}`;
    const uploadPath = await this.uploader.store(userId, notebookId, `${documentId}_${upload.fileName}`, upload.data);

    const now = new Date().toISOString();
    await this.documents.save({
      id: documentId,
      userId,
      notebookId,
      name: upload.fileName,
      fileType,
      sizeBytes: upload.data.length,
      strategyId: selection.strategy.id,
      strategyConfig: selection.config,
      status: "queued",
      chunkCount: 0,
      uploadPath,
      createdAt: now,
      updatedAt: now,
    });
    await this.jobService.create(userId, notebookId, documentId, jobId);

    this.queue.enqueue(() =>
      this.ingestionService.run({
        userId,
        notebookId,
        documentId,
        jobId,
        fileType,
        uploadPath,
        embeddingModelId: notebook.embeddingModelId,
        dim: notebook.dim,
        selection,
      })
    );

    return { jobId, documentId };
  }

  /** Re-ingest an existing document with a (possibly different) strategy. */
  async reingestDocument(
    userId: string,
    notebookId: string,
    documentId: string,
    chunkingMode: "auto" | "custom",
    strategyId?: string,
    strategyConfig?: unknown
  ): Promise<{ jobId: string }> {
    const notebook = await this.notebookService.get(userId, notebookId);
    const doc = await this.documents.findById(userId, notebookId, documentId);
    if (!doc) throw new DocumentNotFound(documentId);

    const selection = this.chunkingService.select(doc.fileType, chunkingMode, strategyId, strategyConfig);
    const jobId = `job_${randomUUID()}`;
    await this.documents.update(userId, notebookId, documentId, (d) => ({
      ...d,
      status: "queued",
      strategyId: selection.strategy.id,
      strategyConfig: selection.config,
      error: undefined,
    }));
    await this.jobService.create(userId, notebookId, documentId, jobId);

    this.queue.enqueue(() =>
      this.ingestionService.run({
        userId,
        notebookId,
        documentId,
        jobId,
        fileType: doc.fileType,
        uploadPath: doc.uploadPath,
        embeddingModelId: notebook.embeddingModelId,
        dim: notebook.dim,
        selection,
      })
    );
    return { jobId };
  }

  async deleteDocument(userId: string, notebookId: string, documentId: string): Promise<void> {
    await this.notebookService.get(userId, notebookId);
    const doc = await this.documents.findById(userId, notebookId, documentId);
    if (!doc) throw new DocumentNotFound(documentId);
    // vectors first (so a crash can't leave phantom citations), then upload, then metadata
    await this.vectors.deleteByDocument(userId, notebookId, documentId);
    await this.uploader.remove(doc.uploadPath).catch(() => {});
    await this.documents.delete(userId, notebookId, documentId);
  }

  // ---- jobs ----

  async getJob(userId: string, jobId: string): Promise<Job | null> {
    return this.jobService.get(userId, jobId);
  }

  subscribeJob(jobId: string, observer: JobObserver): () => void {
    return this.jobService.subscribe(jobId, observer);
  }

  // ---- query ----

  async *query(userId: string, notebookId: string, input: QueryInput): AsyncGenerator<QueryEvent> {
    const notebook = await this.notebookService.get(userId, notebookId);
    yield* this.queryService.query(notebook, input);
  }
}
