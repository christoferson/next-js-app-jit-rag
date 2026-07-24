"use client";

// Minimal UI kit (buttons, badges, dialog, skeleton) — dark-first, token-driven.
import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function Button({
  variant = "default",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors",
        "disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent",
        size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "default" && "bg-surface-2 border border-border-token hover:bg-border-token/50",
        variant === "primary" && "bg-accent text-white dark:text-zinc-900 hover:opacity-90",
        variant === "danger" && "bg-danger-soft text-danger border border-danger/30 hover:bg-danger/20",
        variant === "ghost" && "hover:bg-surface-2 text-muted hover:text-foreground",
        className
      )}
      {...props}
    />
  );
}

export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: "neutral" | "accent" | "info" | "warn" | "danger" | "ok";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap",
        tone === "neutral" && "bg-surface-2 text-muted",
        tone === "accent" && "bg-accent-soft text-accent",
        tone === "info" && "bg-info-soft text-info",
        tone === "warn" && "bg-warn-soft text-warn",
        tone === "danger" && "bg-danger-soft text-danger",
        tone === "ok" && "bg-ok-soft text-ok",
        className
      )}
    >
      {children}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("animate-pulse rounded-md bg-surface-2", className)} />;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        role="dialog"
        aria-modal
        className={cx(
          "relative w-full rounded-xl border border-border-token bg-surface p-5 shadow-2xl",
          wide ? "max-w-2xl" : "max-w-md"
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            <X size={14} />
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({
  label,
  help,
  aside,
  children,
}: {
  label: string;
  help?: string;
  /** optional trailing content on the label row, e.g. a live value badge */
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted">{label}</span>
        {aside}
      </span>
      {children}
      {help && <span className="block text-[11px] text-muted/80">{help}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border-token bg-surface-2 px-3 py-2 text-sm outline-none focus:border-accent placeholder:text-muted/60";
