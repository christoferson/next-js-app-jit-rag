"use client";

// Console shell: sidebar (notebook switcher) + workspace (documents & chat).
import { useCallback, useEffect, useState } from "react";
import { BookOpen } from "lucide-react";
import { api, type NotebookSummary } from "@/lib/api";
import { Sidebar } from "@/components/notebook/sidebar";
import { Workspace } from "@/components/notebook/workspace";

export default function Home() {
  const [notebooks, setNotebooks] = useState<NotebookSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const list = await api.listNotebooks();
      setNotebooks(list);
      setSelectedId((prev) => (prev && list.some((n) => n.id === prev) ? prev : (list[0]?.id ?? null)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        notebooks={notebooks}
        loading={loading}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onCreated={async (id) => {
          await refresh();
          setSelectedId(id);
        }}
      />
      <main className="flex min-w-0 flex-1 flex-col">
        {selectedId ? (
          <Workspace
            key={selectedId}
            notebookId={selectedId}
            onDocumentsChanged={refresh}
            onDeleted={() => {
              setSelectedId(null);
              refresh();
            }}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted">
            <BookOpen size={32} className="text-accent/60" />
            <p className="text-sm">{loading ? "Loading notebooks…" : "Create a notebook to get started."}</p>
          </div>
        )}
      </main>
    </div>
  );
}
