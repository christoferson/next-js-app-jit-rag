"use client";

// Notebook workspace: documents panel (upload + table) and chat area.
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Trash2 } from "lucide-react";
import { api, type DocumentDto, type NotebookDetail } from "@/lib/api";
import { Badge, Button, Dialog, Skeleton } from "../ui/primitives";
import { UploadPanel } from "../upload/upload-panel";
import { DocumentsTable } from "../documents/documents-table";
import { ChatPanel } from "../chat/chat-panel";
import { StrategyConfigControls } from "../upload/strategy-config";
import type { StrategyDto } from "@/lib/api";

export function Workspace({
  notebookId,
  onDeleted,
  onDocumentsChanged,
}: {
  notebookId: string;
  onDeleted: () => void;
  onDocumentsChanged?: () => void;
}) {
  const [detail, setDetail] = useState<NotebookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeJobs, setActiveJobs] = useState<Record<string, string>>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reingestDoc, setReingestDoc] = useState<DocumentDto | null>(null);

  const refresh = useCallback(async () => {
    try {
      const d = await api.openNotebook(notebookId);
      setDetail(d);
      // drop finished jobs from the active map
      setActiveJobs((prev) => {
        const next = { ...prev };
        for (const doc of d.documents) {
          if (doc.status === "indexed" || doc.status === "error") delete next[doc.id];
        }
        return next;
      });
    } catch {
      // notebook may have been deleted elsewhere
    }
  }, [notebookId]);

  // Workspace is remounted per notebook (key={notebookId}), so initial state is fresh.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [refresh]);

  const onQueued = (jobs: { jobId: string; documentId: string; fileName: string }[]) => {
    setActiveJobs((prev) => ({
      ...prev,
      ...Object.fromEntries(jobs.map((j) => [j.documentId, j.jobId])),
    }));
    refresh();
    onDocumentsChanged?.(); // keep sidebar doc counts in sync
  };

  const deleteNotebook = async () => {
    await api.deleteNotebook(notebookId);
    setDeleteOpen(false);
    onDeleted();
  };

  const hasIndexed = (detail?.documents ?? []).some((d) => d.status === "indexed");

  return (
    <div className="flex min-h-0 flex-1">
      {/* Documents column */}
      <section className="flex w-[46%] min-w-[420px] flex-col border-r border-border-token">
        <header className="flex items-center gap-2 border-b border-border-token px-4 py-3">
          {loading ? (
            <Skeleton className="h-6 w-48" />
          ) : (
            <>
              <h2 className="truncate text-sm font-semibold">{detail?.notebook.name}</h2>
              <Badge tone="accent">{detail?.embeddingModel.displayName}</Badge>
              <Badge tone="neutral" className="tnum">dim {detail?.notebook.dim}</Badge>
              <span className="tnum ml-auto text-xs text-muted">
                {detail?.totals.documents ?? 0} docs · {detail?.totals.chunks ?? 0} chunks
              </span>
              <Button size="sm" variant="ghost" title="Delete notebook" onClick={() => setDeleteOpen(true)}>
                <Trash2 size={14} className="text-danger" />
              </Button>
            </>
          )}
        </header>

        {(detail?.totals.documents ?? 0) > 0 && (
          <p className="flex items-center gap-1.5 border-b border-border-token bg-warn-soft/50 px-4 py-1.5 text-[11px] text-warn">
            <AlertTriangle size={12} />
            Embedding model is locked — this notebook already has documents.
          </p>
        )}

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <UploadPanel notebookId={notebookId} onQueued={onQueued} />
          <DocumentsTable
            documents={detail?.documents ?? []}
            loading={loading}
            activeJobs={activeJobs}
            onRefresh={refresh}
            onDelete={async (docId) => {
              await api.deleteDocument(notebookId, docId);
              refresh();
              onDocumentsChanged?.();
            }}
            onReingest={(doc) => setReingestDoc(doc)}
          />
        </div>
      </section>

      {/* Chat column */}
      <section className="flex min-w-0 flex-1 flex-col">
        <ChatPanel notebookId={notebookId} hasIndexedDocs={hasIndexed} llmDefault={detail?.llmDefault} />
      </section>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Delete notebook?">
        <div className="space-y-4">
          <p className="text-sm text-muted">
            This permanently removes <span className="font-medium text-foreground">{detail?.notebook.name}</span> —
            its documents, vector index, and uploaded files. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button variant="danger" onClick={deleteNotebook}>
              <Trash2 size={14} /> Delete permanently
            </Button>
          </div>
        </div>
      </Dialog>

      {reingestDoc && (
        <ReingestDialog
          notebookId={notebookId}
          doc={reingestDoc}
          onClose={() => setReingestDoc(null)}
          onQueued={(jobId) => {
            setActiveJobs((prev) => ({ ...prev, [reingestDoc.id]: jobId }));
            setReingestDoc(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ReingestDialog({
  notebookId,
  doc,
  onClose,
  onQueued,
}: {
  notebookId: string;
  doc: DocumentDto;
  onClose: () => void;
  onQueued: (jobId: string) => void;
}) {
  const [strategies, setStrategies] = useState<StrategyDto[]>([]);
  const [strategyId, setStrategyId] = useState(doc.strategyId);
  const [config, setConfig] = useState<Record<string, unknown>>(doc.strategyConfig);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getStrategies(doc.fileType)
      .then((res) => setStrategies(res.strategies))
      .catch(() => {});
  }, [doc.fileType]);

  const selected = strategies.find((s) => s.id === strategyId);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.reingestDocument(notebookId, doc.id, "custom", strategyId, config);
      onQueued(res.jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Re-ingest failed");
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title={`Re-ingest "${doc.name}"`} wide>
      <div className="space-y-4">
        <p className="text-xs text-muted">Replaces the document&apos;s chunks using the selected strategy.</p>
        <select
          value={strategyId}
          onChange={(e) => {
            setStrategyId(e.target.value);
            const next = strategies.find((s) => s.id === e.target.value);
            if (next) setConfig(Object.fromEntries(next.configSchema.map((f) => [f.key, f.default])));
          }}
          className="w-full rounded-lg border border-border-token bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent"
        >
          {strategies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName} — {s.description}
            </option>
          ))}
        </select>
        {selected && <StrategyConfigControls schema={selected.configSchema} value={config} onChange={setConfig} />}
        {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={run} disabled={busy}>
            Re-ingest
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
