// Typed client for the API routes + the single SSE parsing choke point.
// Components import ONLY from here (and lib/stream/events types) — never adapters/repos.
import { decodeSse, type QueryEvent } from "./stream/events";
import type { StrategyConfigField } from "./chunking/types";

// ---------- DTOs (mirror route payloads) ----------

export interface NotebookSummary {
  id: string;
  name: string;
  docCount: number;
  createdAt: string;
}

export interface NotebookDetail {
  notebook: { id: string; name: string; embeddingModelId: string; dim: number; createdAt: string };
  documents: DocumentDto[];
  totals: { documents: number; chunks: number };
  embeddingModel: { id: string; displayName: string; dim: number };
  llmDefault: { id: string; displayName: string };
}

export interface DocumentDto {
  id: string;
  name: string;
  fileType: string;
  sizeBytes: number;
  strategyId: string;
  strategyConfig: Record<string, unknown>;
  status: "queued" | "parsing" | "chunking" | "embedding" | "indexed" | "error";
  chunkCount: number;
  error?: string;
  createdAt: string;
}

export interface JobDto {
  id: string;
  documentId: string;
  status: "queued" | "running" | "done" | "error";
  phase: string;
  processed: number;
  total: number;
  chunks?: number;
  error?: string;
}

export interface StrategyDto {
  id: string;
  displayName: string;
  description: string;
  configSchema: StrategyConfigField[];
}

export interface ModelsDto {
  embeddingModels: { id: string; displayName: string; dim: number; modality: string }[];
  llmModels: { id: string; displayName: string; supportsTemperature: boolean; defaultTemperature: number }[];
}

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(err?.code ?? "HTTP_ERROR", err?.message ?? `Request failed (${res.status})`, res.status);
  }
  return body as T;
}

// ---------- notebooks ----------

export const api = {
  listNotebooks: () => request<NotebookSummary[]>("/api/notebooks"),

  createNotebook: (name: string, embeddingModelId: string) =>
    request<{ id: string; name: string; dim: number }>("/api/notebooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, embeddingModelId }),
    }),

  openNotebook: (id: string) => request<NotebookDetail>(`/api/notebooks/${id}`),

  deleteNotebook: (id: string) => request<{ deleted: boolean }>(`/api/notebooks/${id}`, { method: "DELETE" }),

  uploadDocument: (
    notebookId: string,
    file: File,
    chunkingMode: "auto" | "custom",
    strategyId?: string,
    strategyConfig?: Record<string, unknown>
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("chunkingMode", chunkingMode);
    if (strategyId) form.append("strategyId", strategyId);
    if (strategyConfig) form.append("strategyConfig", JSON.stringify(strategyConfig));
    return request<{ jobId: string; documentId: string }>(`/api/notebooks/${notebookId}/documents`, {
      method: "POST",
      body: form,
    });
  },

  reingestDocument: (
    notebookId: string,
    documentId: string,
    chunkingMode: "auto" | "custom",
    strategyId?: string,
    strategyConfig?: Record<string, unknown>
  ) =>
    request<{ jobId: string }>(`/api/notebooks/${notebookId}/documents/${documentId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunkingMode, strategyId, strategyConfig }),
    }),

  deleteDocument: (notebookId: string, documentId: string) =>
    request<{ deleted: boolean }>(`/api/notebooks/${notebookId}/documents/${documentId}`, { method: "DELETE" }),

  getJob: (jobId: string) => request<JobDto>(`/api/jobs/${jobId}`),

  getStrategies: (fileType?: string) =>
    request<{ strategies: StrategyDto[]; defaultForType: string | Record<string, string> | null }>(
      fileType ? `/api/strategies?fileType=${encodeURIComponent(fileType)}` : "/api/strategies"
    ),

  getModels: () => request<ModelsDto>("/api/models"),
};

// ---------- SSE query stream ----------

export interface QueryRequest {
  question: string;
  topK?: number;
  documentId?: string;
  llmModelId?: string;
  temperature?: number;
}

/**
 * Streams query events. Unknown/malformed frames are skipped (never throw).
 * Returns when the stream ends; abort via the signal (Stop button).
 */
export async function streamQuery(
  notebookId: string,
  req: QueryRequest,
  onEvent: (event: QueryEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`/api/notebooks/${notebookId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question: req.question,
      topK: req.topK ?? 5,
      filter: req.documentId ? { documentId: req.documentId } : undefined,
      llmModelId: req.llmModelId,
      temperature: req.temperature,
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    const err = body?.error;
    throw new ApiError(err?.code ?? "HTTP_ERROR", err?.message ?? `Query failed (${res.status})`, res.status);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of frame.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const event = decodeSse(line.slice(6));
        if (event) onEvent(event as QueryEvent);
        else console.warn("[sse] skipped malformed frame:", line.slice(6, 80));
      }
    }
  }
}
