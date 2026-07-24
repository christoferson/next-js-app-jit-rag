"use client";

// Chat/query area: streaming markdown answer with inline [n] citation markers that
// expand into source cards (document, page from provenance, snippet, score).
import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CircleStop, Cpu, Loader2, Search, Send, SlidersHorizontal } from "lucide-react";
import { api, streamQuery, type ModelsDto } from "@/lib/api";
import type { CitationEvent } from "@/lib/stream/events";
import { Badge, Button, cx } from "../ui/primitives";

type LlmModel = ModelsDto["llmModels"][number];

interface AssistantTurn {
  role: "assistant";
  text: string;
  citations: CitationEvent[];
  retrievedCount?: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  error?: string;
  streaming: boolean;
  doneReason?: string;
  /** display name of the model used to produce this answer */
  modelName?: string;
  topK?: number;
}

interface UserTurn {
  role: "user";
  text: string;
}

type Turn = UserTurn | AssistantTurn;

function CitationCard({ citation }: { citation: CitationEvent }) {
  return (
    <div className="rounded-lg border border-info/30 bg-info-soft/50 p-2.5 text-xs">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone="info">[{citation.index}]</Badge>
        <span className="font-medium">{citation.documentName}</span>
        {citation.page !== undefined && <span className="text-muted">p.{citation.page}</span>}
        {citation.page === undefined && citation.charStart !== undefined && (
          <span className="tnum text-muted">
            chars {citation.charStart}–{citation.charEnd}
          </span>
        )}
        <span className="tnum ml-auto text-muted">score {citation.score.toFixed(3)}</span>
      </div>
      <p className="text-muted">{citation.snippet}</p>
    </div>
  );
}

/** Splits markdown-ish text on [n] markers and renders them as expandable chips. */
function AnswerBody({ turn, onToggle, expanded }: { turn: AssistantTurn; onToggle: (n: number) => void; expanded: Set<number> }) {
  const byIndex = new Map(turn.citations.map((c) => [c.index, c]));
  const parts = turn.text.split(/(\[\d+\])/g);
  return (
    <div className={cx("prose-chat text-sm leading-relaxed", turn.streaming && "stream-cursor")}>
      {parts.map((part, i) => {
        const m = /^\[(\d+)\]$/.exec(part);
        const n = m ? Number(m[1]) : null;
        if (n !== null && byIndex.has(n)) {
          return (
            <button
              key={i}
              onClick={() => onToggle(n)}
              className={cx(
                "mx-0.5 inline-flex items-center rounded px-1 text-[11px] font-semibold align-super transition-colors",
                expanded.has(n) ? "bg-info text-white" : "bg-info-soft text-info hover:bg-info/30"
              )}
            >
              {n}
            </button>
          );
        }
        return <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} allowedElements={undefined} unwrapDisallowed components={{ p: ({ children }) => <span>{children}</span> }}>{part}</ReactMarkdown>;
      })}
    </div>
  );
}

export function ChatPanel({
  notebookId,
  hasIndexedDocs,
  llmDefault,
}: {
  notebookId: string;
  hasIndexedDocs: boolean;
  llmDefault?: { id: string; displayName: string };
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [topK, setTopK] = useState(5);
  const [models, setModels] = useState<LlmModel[]>([]);
  const [modelId, setModelId] = useState<string | undefined>(undefined);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [searching, setSearching] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Load the LLM registry once; default the picker to the notebook's model.
  useEffect(() => {
    let cancelled = false;
    api
      .getModels()
      .then((res) => {
        if (cancelled) return;
        setModels(res.llmModels);
        setModelId((prev) => prev ?? llmDefault?.id ?? res.llmModels[0]?.id);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [llmDefault?.id]);

  const activeModel = models.find((m) => m.id === modelId);
  const activeModelName = activeModel?.displayName ?? llmDefault?.displayName ?? "default model";

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  }, []);

  const send = useCallback(async () => {
    const q = question.trim();
    if (!q || streaming) return;
    setQuestion("");
    setExpanded(new Set());
    setStreaming(true);
    setSearching(null);
    stickToBottom.current = true;

    const assistant: AssistantTurn = {
      role: "assistant",
      text: "",
      citations: [],
      streaming: true,
      modelName: activeModelName,
      topK,
    };
    setTurns((prev) => [...prev, { role: "user", text: q }, assistant]);
    const patch = (mut: (a: AssistantTurn) => AssistantTurn) =>
      setTurns((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last?.role === "assistant") next[next.length - 1] = mut(last);
        return next;
      });

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      await streamQuery(
        notebookId,
        { question: q, topK, llmModelId: modelId },
        (event) => {
          switch (event.type) {
            case "retrieval":
              setSearching(event.count);
              patch((a) => ({ ...a, retrievedCount: event.count }));
              break;
            case "text-delta":
              setSearching(null);
              patch((a) => ({ ...a, text: a.text + event.text }));
              break;
            case "citation":
              patch((a) => ({ ...a, citations: [...a.citations, event] }));
              break;
            case "usage":
              patch((a) => ({ ...a, usage: { inputTokens: event.inputTokens, outputTokens: event.outputTokens } }));
              break;
            case "done":
              patch((a) => ({
                ...a,
                streaming: false,
                doneReason: event.reason,
                text:
                  event.reason === "no_documents"
                    ? "This notebook has no indexed documents yet. Add documents to start researching."
                    : a.text,
              }));
              break;
            case "error":
              patch((a) => ({ ...a, streaming: false, error: event.message }));
              break;
          }
        },
        controller.signal
      );
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        patch((a) => ({ ...a, streaming: false, error: err instanceof Error ? err.message : "Query failed" }));
      }
    } finally {
      patch((a) => ({ ...a, streaming: false }));
      setStreaming(false);
      setSearching(null);
      abortRef.current = null;
    }
  }, [notebookId, question, streaming, topK, modelId, activeModelName]);

  const stop = () => abortRef.current?.abort();

  const toggleCitation = (n: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="flex h-full items-center justify-center">
            <p className="max-w-sm text-center text-sm text-muted">
              {hasIndexedDocs
                ? "Ask a question about this notebook's documents. Answers are grounded and cited."
                : "Add documents to start researching."}
            </p>
          </div>
        )}
        {turns.map((turn, i) =>
          turn.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-accent-soft px-3.5 py-2 text-sm">
                {turn.text}
              </div>
            </div>
          ) : (
            <div key={i} className="flex justify-start">
              <div className="max-w-[85%] space-y-2 rounded-2xl rounded-bl-sm border border-border-token bg-surface px-3.5 py-2.5">
                {turn.retrievedCount !== undefined && turn.text === "" && turn.streaming && (
                  <p className="flex items-center gap-1.5 text-xs text-muted">
                    <Search size={12} className="animate-pulse" />
                    Searching {turn.retrievedCount} chunks…
                  </p>
                )}
                {turn.error ? (
                  <p className="rounded-lg bg-danger-soft px-2.5 py-1.5 text-xs text-danger">{turn.error}</p>
                ) : (
                  <AnswerBody turn={turn} onToggle={toggleCitation} expanded={expanded} />
                )}
                {turn.citations.filter((c) => expanded.has(c.index)).map((c) => (
                  <CitationCard key={c.index} citation={c} />
                ))}
                {!turn.streaming && turn.citations.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-border-token pt-2">
                    <span className="text-[11px] text-muted">Sources:</span>
                    {turn.citations.map((c) => (
                      <button
                        key={c.index}
                        onClick={() => toggleCitation(c.index)}
                        className={cx(
                          "rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                          expanded.has(c.index) ? "bg-info text-white" : "bg-info-soft text-info hover:bg-info/30"
                        )}
                      >
                        [{c.index}] {c.documentName}
                        {c.page !== undefined ? ` p.${c.page}` : ""}
                      </button>
                    ))}
                  </div>
                )}
                {!turn.streaming && !turn.error && (turn.modelName || turn.usage) && (
                  <p className="tnum flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-muted/70">
                    {turn.modelName && (
                      <span className="inline-flex items-center gap-1">
                        <Cpu size={10} />
                        {turn.modelName}
                      </span>
                    )}
                    {turn.topK !== undefined && <span>· topK {turn.topK}</span>}
                    {turn.usage && (
                      <span>
                        · {turn.usage.inputTokens ?? "?"} in · {turn.usage.outputTokens ?? "?"} out tokens
                      </span>
                    )}
                  </p>
                )}
              </div>
            </div>
          )
        )}
        {searching !== null && <div className="h-px" />}
      </div>

      <div className="border-t border-border-token p-3">
        {/* Settings bar: current model + retrieval depth, expandable */}
        <div className="mb-2 flex items-center gap-2 text-[11px]">
          <button
            type="button"
            onClick={() => setSettingsOpen((v) => !v)}
            aria-expanded={settingsOpen}
            className={cx(
              "inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 font-medium transition-colors",
              settingsOpen
                ? "border-accent bg-accent-soft text-accent"
                : "border-border-token bg-surface-2 text-muted hover:text-foreground"
            )}
            title="Query settings"
          >
            <SlidersHorizontal size={12} />
            Settings
          </button>
          <span className="inline-flex items-center gap-1 text-muted" title="Inference model">
            <Cpu size={12} />
            {activeModelName}
          </span>
          <span className="text-muted/70" title="Chunks retrieved per query">
            · topK {topK}
          </span>
        </div>

        {settingsOpen && (
          <div className="mb-2 grid grid-cols-1 gap-3 rounded-lg border border-border-token bg-surface-2/60 p-3 sm:grid-cols-2">
            <label className="block space-y-1.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-muted">Inference model</span>
              </span>
              <select
                value={modelId ?? ""}
                onChange={(e) => setModelId(e.target.value)}
                disabled={models.length === 0}
                className="w-full rounded-lg border border-border-token bg-surface px-3 py-2 text-sm outline-none focus:border-accent disabled:opacity-50"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {llmDefault?.id === m.id ? " (notebook default)" : ""}
                  </option>
                ))}
              </select>
              {activeModel && (
                <span className="block text-[11px] text-muted/80">
                  {activeModel.supportsTemperature ? `temperature ${activeModel.defaultTemperature}` : "fixed sampling"}
                </span>
              )}
            </label>

            <label className="block space-y-1.5">
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-muted">Chunks retrieved (topK)</span>
                <span className="tnum text-xs font-semibold text-foreground">{topK}</span>
              </span>
              <input
                type="range"
                min={1}
                max={20}
                step={1}
                value={topK}
                onChange={(e) => setTopK(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
              <span className="flex justify-between text-[10px] text-muted/70 tnum">
                <span>1</span>
                <span>20</span>
              </span>
            </label>
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={question}
            onChange={(e) => {
              setQuestion(e.target.value);
              const el = textareaRef.current;
              if (el) {
                el.style.height = "auto";
                el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
              }
            }}
            onKeyDown={(e) => {
              if ((e.key === "Enter" && !e.shiftKey) || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                e.preventDefault();
                send();
              }
            }}
            rows={1}
            placeholder={hasIndexedDocs ? "Ask about your documents… (Enter to send, Shift+Enter for newline)" : "Add documents first…"}
            className="max-h-40 min-h-[38px] flex-1 resize-none rounded-xl border border-border-token bg-surface-2 px-3.5 py-2 text-sm outline-none focus:border-accent placeholder:text-muted/60"
          />
          <div className="flex items-center gap-2">
            {streaming ? (
              <Button variant="danger" onClick={stop} title="Stop generation">
                <CircleStop size={15} />
                Stop
              </Button>
            ) : (
              <Button variant="primary" onClick={send} disabled={!question.trim() || !hasIndexedDocs}>
                {streaming ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
