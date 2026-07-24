"use client";

// Documents table: name, size, strategy badge, chunk count, live status pill, actions.
// Rows with active jobs are driven by polling GET /api/jobs/[id].
import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, RefreshCcw, Trash2 } from "lucide-react";
import type { DocumentDto } from "@/lib/api";
import { Badge, Button, Skeleton } from "../ui/primitives";

const STATUS_TONE: Record<DocumentDto["status"], "neutral" | "info" | "ok" | "danger" | "warn"> = {
  queued: "neutral",
  parsing: "info",
  chunking: "info",
  embedding: "info",
  indexed: "ok",
  error: "danger",
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function DocumentsTable({
  documents,
  loading,
  activeJobs,
  onRefresh,
  onDelete,
  onReingest,
}: {
  documents: DocumentDto[];
  loading: boolean;
  /** documentId → jobId for in-flight ingestions */
  activeJobs: Record<string, string>;
  onRefresh: () => void;
  onDelete: (docId: string) => void;
  onReingest: (doc: DocumentDto) => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasActive =
    Object.keys(activeJobs).length > 0 ||
    documents.some((d) => ["queued", "parsing", "chunking", "embedding"].includes(d.status));

  useEffect(() => {
    if (!hasActive) {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
      return;
    }
    pollRef.current = setInterval(onRefresh, 1200);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasActive, onRefresh]);

  if (loading) {
    return (
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border-token px-4 py-6 text-center text-sm text-muted">
        No documents yet — upload files above to start.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border-token">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-token bg-surface-2/60 text-left text-[11px] uppercase tracking-wide text-muted">
            <th className="px-3 py-2 font-medium">Document</th>
            <th className="px-3 py-2 font-medium">Size</th>
            <th className="px-3 py-2 font-medium">Strategy</th>
            <th className="px-3 py-2 font-medium tnum">Chunks</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {documents.map((doc) => {
            const busy = ["queued", "parsing", "chunking", "embedding"].includes(doc.status);
            return (
              <tr key={doc.id} className="border-b border-border-token/60 last:border-0 hover:bg-surface-2/40">
                <td className="max-w-[220px] px-3 py-2">
                  <div className="flex items-center gap-2">
                    <FileText size={14} className="shrink-0 text-muted" />
                    <span className="truncate" title={doc.name}>
                      {doc.name}
                    </span>
                  </div>
                </td>
                <td className="tnum px-3 py-2 text-muted">{formatSize(doc.sizeBytes)}</td>
                <td className="px-3 py-2">
                  <Badge tone="accent">{doc.strategyId}</Badge>
                </td>
                <td className="tnum px-3 py-2">{doc.status === "indexed" ? doc.chunkCount : "—"}</td>
                <td className="px-3 py-2">
                  <span title={doc.error ?? undefined}>
                    <Badge tone={STATUS_TONE[doc.status]}>
                      {busy && <Loader2 size={10} className="animate-spin" />}
                      {doc.status}
                      {doc.status === "error" && doc.error ? `: ${doc.error.slice(0, 60)}` : ""}
                    </Badge>
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Re-ingest with a different strategy"
                      disabled={busy}
                      onClick={() => onReingest(doc)}
                    >
                      <RefreshCcw size={13} />
                    </Button>
                    {confirmDelete === doc.id ? (
                      <Button size="sm" variant="danger" onClick={() => onDelete(doc.id)}>
                        Confirm
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" title="Delete document" onClick={() => setConfirmDelete(doc.id)}>
                        <Trash2 size={13} />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
