// Domain entities + repository interfaces. File impls now; Postgres/Dynamo later — same methods.
import type { JobPhase } from "../stream/events";

export interface Notebook {
  id: string;
  userId: string;
  name: string;
  embeddingModelId: string;
  dim: number;
  createdAt: string; // ISO
}

export type DocumentStatus = "queued" | "parsing" | "chunking" | "embedding" | "indexed" | "error";

export interface DocumentEntity {
  id: string;
  userId: string;
  notebookId: string;
  name: string;
  fileType: string; // 'txt' | 'pdf' | ...
  sizeBytes: number;
  strategyId: string;
  strategyConfig: Record<string, unknown>;
  status: DocumentStatus;
  chunkCount: number;
  error?: string;
  uploadPath: string; // repo-relative path of the stored upload
  createdAt: string;
  updatedAt: string;
}

export type JobStatus = "queued" | "running" | "done" | "error";

export interface Job {
  id: string;
  userId: string;
  notebookId: string;
  documentId: string;
  status: JobStatus;
  phase: JobPhase;
  processed: number;
  total: number;
  chunks?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NotebookRepository {
  save(notebook: Notebook): Promise<void>;
  findById(userId: string, id: string): Promise<Notebook | null>;
  listByUser(userId: string): Promise<Notebook[]>;
  delete(userId: string, id: string): Promise<void>;
}

export interface DocumentRepository {
  save(doc: DocumentEntity): Promise<void>;
  findById(userId: string, notebookId: string, id: string): Promise<DocumentEntity | null>;
  listByNotebook(userId: string, notebookId: string): Promise<DocumentEntity[]>;
  /** read-modify-write under a per-document lock */
  update(
    userId: string,
    notebookId: string,
    id: string,
    mutate: (doc: DocumentEntity) => DocumentEntity
  ): Promise<DocumentEntity>;
  delete(userId: string, notebookId: string, id: string): Promise<void>;
}

export interface JobRepository {
  save(job: Job): Promise<void>;
  findById(userId: string, id: string): Promise<Job | null>;
  /** read-modify-write under a per-job lock */
  update(userId: string, id: string, mutate: (job: Job) => Job): Promise<Job>;
}
