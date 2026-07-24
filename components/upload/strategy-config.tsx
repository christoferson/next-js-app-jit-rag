"use client";

// Renders strategy config controls PURELY from configSchema — no per-strategy
// if/switch anywhere. A new strategy's controls appear with zero UI edits.
import { Check } from "lucide-react";
import type { StrategyConfigField } from "@/lib/chunking/types";
import { Field, inputClass } from "../ui/primitives";

export function StrategyConfigControls({
  schema,
  value,
  onChange,
}: {
  schema: StrategyConfigField[];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v });

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {schema.map((field) => {
        const current = value[field.key] ?? field.default;
        switch (field.type) {
          case "number": {
            const num = Number(current);
            const useSlider = field.min !== undefined && field.max !== undefined;
            const unit = field.unit ? ` ${field.unit}` : "";
            const valueBadge = (
              <span className="tnum text-xs font-semibold text-foreground">
                {num.toLocaleString()}
                {field.unit && <span className="font-normal text-muted">{unit}</span>}
              </span>
            );
            return (
              <Field key={field.key} label={field.label} help={field.help} aside={useSlider ? valueBadge : undefined}>
                {useSlider ? (
                  <div className="space-y-1">
                    <input
                      type="range"
                      min={field.min}
                      max={field.max}
                      step={field.step ?? 1}
                      value={num}
                      onChange={(e) => set(field.key, Number(e.target.value))}
                      className="w-full accent-[var(--accent)]"
                    />
                    <div className="flex justify-between text-[10px] text-muted/70 tnum">
                      <span>
                        {Number(field.min).toLocaleString()}
                        {unit}
                      </span>
                      <span>
                        {Number(field.max).toLocaleString()}
                        {unit}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="number"
                      value={num}
                      onChange={(e) => set(field.key, Number(e.target.value))}
                      className={`${inputClass} tnum ${field.unit ? "pr-14" : ""}`}
                    />
                    {field.unit && (
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted">
                        {field.unit}
                      </span>
                    )}
                  </div>
                )}
              </Field>
            );
          }
          case "boolean":
            return (
              <Field key={field.key} label={field.label} help={field.help}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={current === true}
                  onClick={() => set(field.key, current !== true)}
                  className={`relative h-6 w-11 rounded-full transition-colors ${
                    current === true ? "bg-accent" : "bg-border-token"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      current === true ? "translate-x-5" : "translate-x-0.5"
                    }`}
                  />
                </button>
              </Field>
            );
          case "multiselect": {
            const chosen = new Set(
              Array.isArray(current) ? (current as unknown[]).map(String) : []
            );
            const toggle = (v: string) => {
              const next = new Set(chosen);
              if (next.has(v)) next.delete(v);
              else next.add(v);
              // preserve the schema's option order
              set(
                field.key,
                (field.options ?? []).map((o) => o.value).filter((val) => next.has(val))
              );
            };
            return (
              <div key={field.key} className="sm:col-span-2">
                <Field label={field.label} help={field.help}>
                  <div className="flex flex-wrap gap-1.5">
                    {(field.options ?? []).map((opt) => {
                      const active = chosen.has(opt.value);
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          role="checkbox"
                          aria-checked={active}
                          onClick={() => toggle(opt.value)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                            active
                              ? "border-accent bg-accent-soft text-accent"
                              : "border-border-token bg-surface-2 text-muted hover:text-foreground"
                          }`}
                        >
                          <span
                            className={`flex h-3.5 w-3.5 items-center justify-center rounded-[4px] border transition-colors ${
                              active ? "border-accent bg-accent text-white dark:text-zinc-900" : "border-border-token"
                            }`}
                          >
                            {active && <Check size={10} strokeWidth={3} />}
                          </span>
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </div>
            );
          }
          case "select":
            return (
              <Field key={field.key} label={field.label} help={field.help}>
                <select
                  value={String(current)}
                  onChange={(e) => set(field.key, e.target.value)}
                  className={inputClass}
                >
                  {(field.options ?? []).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </Field>
            );
          case "string":
          default:
            return (
              <Field key={field.key} label={field.label} help={field.help}>
                <input
                  type="text"
                  value={String(current)}
                  onChange={(e) => set(field.key, e.target.value)}
                  className={`${inputClass} font-mono`}
                />
              </Field>
            );
        }
      })}
    </div>
  );
}
