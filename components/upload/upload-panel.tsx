"use client";

// Drag-and-drop upload with per-file ingestion settings:
// Auto (default by type) vs Custom (applicable strategies + schema-driven config).
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileUp, Loader2, Settings2, UploadCloud } from "lucide-react";
import { api, type StrategyDto } from "@/lib/api";
import { Badge, Button, cx } from "../ui/primitives";
import { StrategyConfigControls } from "./strategy-config";

const MAX_MB = 50;

interface PendingFile {
  file: File;
  fileType: string;
  mode: "auto" | "custom";
  strategyId?: string;
  config: Record<string, unknown>;
  oversize: boolean;
}

function fileTypeOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function defaultsOf(schema: StrategyDto["configSchema"]): Record<string, unknown> {
  return Object.fromEntries(schema.map((f) => [f.key, f.default]));
}

export function UploadPanel({
  notebookId,
  onQueued,
}: {
  notebookId: string;
  onQueued: (jobs: { jobId: string; documentId: string; fileName: string }[]) => void;
}) {
  const [pending, setPending] = useState<PendingFile[]>([]);
  const [strategiesByType, setStrategiesByType] = useState<
    Record<string, { strategies: StrategyDto[]; defaultId: string | null }>
  >({});
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const neededTypes = useMemo(() => [...new Set(pending.map((p) => p.fileType))], [pending]);

  useEffect(() => {
    for (const t of neededTypes) {
      if (strategiesByType[t]) continue;
      api
        .getStrategies(t)
        .then((res) =>
          setStrategiesByType((prev) => ({
            ...prev,
            [t]: { strategies: res.strategies, defaultId: typeof res.defaultForType === "string" ? res.defaultForType : null },
          }))
        )
        .catch(() => {});
    }
  }, [neededTypes, strategiesByType]);

  const addFiles = useCallback((files: FileList | File[]) => {
    setError(null);
    setPending((prev) => [
      ...prev,
      ...Array.from(files).map((file) => ({
        file,
        fileType: fileTypeOf(file.name),
        mode: "auto" as const,
        config: {},
        oversize: file.size > MAX_MB * 1024 * 1024,
      })),
    ]);
  }, []);

  const updateAt = (i: number, patch: Partial<PendingFile>) =>
    setPending((prev) => prev.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  const upload = async () => {
    setBusy(true);
    setError(null);
    const queued: { jobId: string; documentId: string; fileName: string }[] = [];
    try {
      for (const p of pending) {
        if (p.oversize) continue;
        const res = await api.uploadDocument(
          notebookId,
          p.file,
          p.mode,
          p.mode === "custom" ? p.strategyId : undefined,
          p.mode === "custom" ? p.config : undefined
        );
        queued.push({ ...res, fileName: p.file.name });
      }
      setPending((prev) => prev.filter((p) => p.oversize));
      onQueued(queued);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        className={cx(
          "flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors",
          dragging ? "border-accent bg-accent-soft/40" : "border-border-token bg-surface"
        )}
      >
        <UploadCloud size={22} className="text-muted" />
        <p className="text-sm text-muted">
          Drag files here, or{" "}
          <label className="cursor-pointer font-medium text-accent hover:underline">
            browse
            <input
              type="file"
              multiple
              accept=".txt,.md,.csv,.pdf"
              className="hidden"
              onChange={(e) => e.target.files && addFiles(e.target.files)}
            />
          </label>
        </p>
        <p className="text-[11px] text-muted/70">txt · md · csv · pdf — up to {MAX_MB}MB each</p>
      </div>

      {pending.map((p, i) => {
        const info = strategiesByType[p.fileType];
        const selectedId = p.strategyId ?? info?.defaultId ?? info?.strategies[0]?.id;
        const selected = info?.strategies.find((s) => s.id === selectedId);
        return (
          <div key={`${p.file.name}-${i}`} className="rounded-xl border border-border-token bg-surface p-3 space-y-3">
            <div className="flex items-center gap-2">
              <FileUp size={15} className="shrink-0 text-muted" />
              <span className="truncate text-sm font-medium">{p.file.name}</span>
              <span className="tnum text-[11px] text-muted">{(p.file.size / 1024).toFixed(0)} KB</span>
              {p.oversize && <Badge tone="danger">exceeds {MAX_MB}MB — will not upload</Badge>}
              <div className="ml-auto flex items-center gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setPending((prev) => prev.filter((_, j) => j !== i))}>
                  Remove
                </Button>
              </div>
            </div>

            {!p.oversize && (
              <>
                <div className="flex items-center gap-1 text-xs">
                  <Settings2 size={13} className="text-muted" />
                  <span className="mr-2 text-muted">Chunking</span>
                  <div className="inline-flex overflow-hidden rounded-lg border border-border-token">
                    {(["auto", "custom"] as const).map((mode) => (
                      <button
                        key={mode}
                        onClick={() => updateAt(i, { mode })}
                        className={cx(
                          "px-2.5 py-1 font-medium transition-colors",
                          p.mode === mode ? "bg-accent-soft text-accent" : "bg-surface-2 text-muted hover:text-foreground"
                        )}
                      >
                        {mode === "auto" ? "Auto (by file type)" : "Custom"}
                      </button>
                    ))}
                  </div>
                  {p.mode === "auto" && info?.defaultId && <Badge tone="accent">{info.defaultId}</Badge>}
                </div>

                {p.mode === "custom" && info && (
                  <div className="space-y-3 rounded-lg bg-surface-2/60 p-3">
                    <select
                      value={selectedId}
                      onChange={(e) => {
                        const next = info.strategies.find((s) => s.id === e.target.value);
                        updateAt(i, {
                          strategyId: e.target.value,
                          config: next ? defaultsOf(next.configSchema) : {},
                        });
                      }}
                      className="w-full rounded-lg border border-border-token bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                    >
                      {info.strategies.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.displayName} — {s.description}
                        </option>
                      ))}
                    </select>
                    {selected && (
                      <StrategyConfigControls
                        schema={selected.configSchema}
                        value={Object.keys(p.config).length > 0 ? p.config : defaultsOf(selected.configSchema)}
                        onChange={(config) => updateAt(i, { config, strategyId: selected.id })}
                      />
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}

      {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}

      {pending.some((p) => !p.oversize) && (
        <Button variant="primary" onClick={upload} disabled={busy} className="w-full">
          {busy ? <Loader2 size={14} className="animate-spin" /> : <UploadCloud size={14} />}
          Upload {pending.filter((p) => !p.oversize).length} file(s)
        </Button>
      )}
    </div>
  );
}
