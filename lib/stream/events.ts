// Typed SSE event unions — the single source of truth for server emit AND client parse.

// ---------- Ingestion job events ----------

export type JobPhase = "queued" | "parsing" | "chunking" | "embedding" | "storing" | "done" | "error";

export interface JobStatusEvent {
  type: "job-status";
  jobId: string;
  status: "queued" | "running" | "done" | "error";
}

export interface FileProgressEvent {
  type: "file-progress";
  jobId: string;
  documentId: string;
  phase: JobPhase;
  processed?: number;
  total?: number;
}

export interface DocIndexedEvent {
  type: "doc-indexed";
  jobId: string;
  documentId: string;
  chunks: number;
}

export interface DocErrorEvent {
  type: "doc-error";
  jobId: string;
  documentId: string;
  reason: string;
}

export interface JobDoneEvent {
  type: "job-done";
  jobId: string;
}

export type IngestionEvent =
  | JobStatusEvent
  | FileProgressEvent
  | DocIndexedEvent
  | DocErrorEvent
  | JobDoneEvent;

// ---------- Query events ----------

export interface RetrievalEvent {
  type: "retrieval";
  count: number;
}

export interface TextDeltaEvent {
  type: "text-delta";
  text: string;
}

export interface CitationEvent {
  type: "citation";
  index: number; // 1-based; matches inline [n] markers
  documentId: string;
  documentName: string;
  page?: number;
  charStart?: number;
  charEnd?: number;
  score: number;
  snippet: string;
}

export interface UsageEvent {
  type: "usage";
  inputTokens?: number;
  outputTokens?: number;
}

export interface DoneEvent {
  type: "done";
  reason?: "no_documents" | "aborted" | "completed";
}

export interface ErrorEvent {
  type: "error";
  code: string;
  message: string;
}

export type QueryEvent =
  | RetrievalEvent
  | TextDeltaEvent
  | CitationEvent
  | UsageEvent
  | DoneEvent
  | ErrorEvent;

export type StreamEvent = IngestionEvent | QueryEvent;

// ---------- SSE wire helpers (shared by server emit + client parse) ----------

export function encodeSse(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/** Parses one SSE `data:` payload. Returns null for malformed/unknown frames (log + skip; never throw). */
export function decodeSse(data: string): StreamEvent | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed && typeof parsed === "object" && typeof parsed.type === "string") {
      return parsed as StreamEvent;
    }
    return null;
  } catch {
    return null;
  }
}
