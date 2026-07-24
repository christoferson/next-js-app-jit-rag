"use client";

// Notebook switcher sidebar: list, create dialog (name + embedding model), ⌘K palette focus.
import { useEffect, useRef, useState } from "react";
import { BookOpen, Moon, Plus, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { api, type ModelsDto, type NotebookSummary } from "@/lib/api";
import { Badge, Button, Dialog, Field, Skeleton, cx, inputClass } from "../ui/primitives";

export function Sidebar({
  notebooks,
  loading,
  selectedId,
  onSelect,
  onCreated,
}: {
  notebooks: NotebookSummary[];
  loading: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreated: (id: string) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [models, setModels] = useState<ModelsDto | null>(null);
  const [modelId, setModelId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement | null>(null);
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        filterRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!createOpen || models) return;
    api
      .getModels()
      .then((m) => {
        setModels(m);
        if (m.embeddingModels[0]) setModelId(m.embeddingModels[0].id);
      })
      .catch(() => setError("Could not load model registry"));
  }, [createOpen, models]);

  const create = async () => {
    if (!name.trim() || !modelId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api.createNotebook(name.trim(), modelId);
      setCreateOpen(false);
      setName("");
      onCreated(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const visible = notebooks.filter((n) => n.name.toLowerCase().includes(filter.toLowerCase()));

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border-token bg-surface">
      <div className="flex items-center gap-2 border-b border-border-token p-4">
        <BookOpen size={18} className="text-accent" />
        <h1 className="text-sm font-semibold tracking-tight">Notebook RAG Console</h1>
        <button
          className="ml-auto rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
          title="Toggle theme"
        >
          <Sun size={14} className="hidden dark:block" />
          <Moon size={14} className="dark:hidden" />
        </button>
      </div>

      <div className="space-y-2 p-3">
        <input
          ref={filterRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter notebooks…  ⌘K"
          className={inputClass}
        />
        <Button variant="primary" className="w-full" onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> New Notebook
        </Button>
      </div>

      <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {loading &&
          [0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
        {!loading && visible.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted">
            {notebooks.length === 0 ? "No notebooks yet." : "No matches."}
          </p>
        )}
        {visible.map((nb) => (
          <button
            key={nb.id}
            onClick={() => onSelect(nb.id)}
            className={cx(
              "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
              selectedId === nb.id
                ? "border-accent/50 bg-accent-soft/60"
                : "border-transparent hover:border-border-token hover:bg-surface-2"
            )}
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{nb.name}</span>
              <Badge tone="accent" className="ml-auto tnum">
                {nb.docCount} doc{nb.docCount === 1 ? "" : "s"}
              </Badge>
            </div>
            <p className="tnum mt-0.5 text-[11px] text-muted">{new Date(nb.createdAt).toLocaleDateString()}</p>
          </button>
        ))}
      </nav>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Notebook">
        <div className="space-y-4">
          <Field label="Name">
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && create()}
              placeholder="e.g. Q3 Research"
              className={inputClass}
            />
          </Field>
          <Field
            label="Embedding model"
            help="Fixes the vector dimension. The model cannot be changed once documents exist."
          >
            <select value={modelId} onChange={(e) => setModelId(e.target.value)} className={inputClass}>
              {(models?.embeddingModels ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName} · dim {m.dim}
                </option>
              ))}
            </select>
          </Field>
          {error && <p className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={busy || !name.trim()}>
              Create
            </Button>
          </div>
        </div>
      </Dialog>
    </aside>
  );
}
