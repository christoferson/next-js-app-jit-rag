// VectorStore seam — LanceDB now, OpenSearch later. Services depend on this interface only.
import type { ChunkMetadata } from "../chunking/types";

export interface VectorRow {
  id: string; // `${documentId}:${ordinal}`
  documentId: string;
  ordinal: number;
  text: string;
  vector: number[];
  /** provenance: page/charStart/charEnd + strategy id, JSON-safe */
  metadata: ChunkMetadata & { strategyId?: string };
}

export interface SearchHit {
  id: string;
  documentId: string;
  ordinal: number;
  text: string;
  /** similarity score in [0,1] (higher = more similar) */
  score: number;
  metadata: ChunkMetadata & { strategyId?: string };
}

export interface SearchOptions {
  topK: number;
  scoreThreshold?: number;
  /** restrict to a single document */
  documentId?: string;
}

export interface VectorStore {
  /** idempotent; dim fixed at creation */
  ensureCollection(userId: string, notebookId: string, dim: number): Promise<void>;
  add(userId: string, notebookId: string, dim: number, rows: VectorRow[]): Promise<void>;
  search(userId: string, notebookId: string, queryVector: number[], options: SearchOptions): Promise<SearchHit[]>;
  deleteByDocument(userId: string, notebookId: string, documentId: string): Promise<void>;
  dropCollection(userId: string, notebookId: string): Promise<void>;
  countRows(userId: string, notebookId: string): Promise<number>;
}
