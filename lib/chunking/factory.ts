// Factory: resolve strategy id → instance (never silent), select explicit-vs-default,
// and compile a strategy's self-describing configSchema into a zod validator.
import { z } from "zod";
import type { ChunkingStrategy, StrategyConfigField } from "./types";
import { CHUNKING_STRATEGIES, DEFAULT_STRATEGY_BY_TYPE } from "./registry";
import { StrategyNotApplicable, StrategyNotFound, UnsupportedFileType } from "../errors/errors";

export function getStrategy(id: string): ChunkingStrategy {
  const strategy = CHUNKING_STRATEGIES.find((s) => s.id === id);
  if (!strategy) throw new StrategyNotFound(id);
  return strategy;
}

export function strategiesFor(fileType: string): ChunkingStrategy[] {
  return CHUNKING_STRATEGIES.filter((s) => s.applicableTo(fileType));
}

/**
 * Selection per SPEC §5.3: explicit strategyId (must be applicable), else default-by-type.
 */
export function selectStrategy(fileType: string, explicitId?: string): ChunkingStrategy {
  if (explicitId) {
    const strategy = getStrategy(explicitId);
    if (!strategy.applicableTo(fileType)) throw new StrategyNotApplicable(explicitId, fileType);
    return strategy;
  }
  const defaultId = DEFAULT_STRATEGY_BY_TYPE[fileType];
  if (!defaultId) throw new UnsupportedFileType(fileType);
  return getStrategy(defaultId);
}

function fieldToZod(field: StrategyConfigField): z.ZodType {
  switch (field.type) {
    case "number": {
      let schema = z.coerce.number();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      // clamp instead of reject (SPEC §5.4: "ranges clamped")
      return z.coerce
        .number()
        .catch(Number(field.default))
        .transform((v) => {
          if (field.min !== undefined && v < field.min) return field.min;
          if (field.max !== undefined && v > field.max) return field.max;
          return schema.safeParse(v).success ? v : Number(field.default);
        });
    }
    case "boolean":
      return z.coerce.boolean().catch(Boolean(field.default));
    case "select": {
      const values = (field.options ?? []).map((o) => o.value);
      return z
        .string()
        .refine((v) => values.includes(v))
        .catch(String(field.default));
    }
    case "multiselect": {
      const values = (field.options ?? []).map((o) => o.value);
      const fallback = Array.isArray(field.default) ? (field.default as string[]) : [];
      // Keep only known values; drop unknowns; fall back to defaults if empty/malformed.
      return z
        .array(z.string())
        .catch(fallback)
        .transform((arr) => {
          const kept = arr.filter((v) => values.includes(v));
          return kept.length > 0 ? kept : fallback;
        });
    }
    case "string":
    default:
      return z.string().catch(String(field.default));
  }
}

/**
 * Compiles a strategy's configSchema into a zod object that strips unknown
 * fields, fills defaults, and clamps out-of-range values. Never trusts the client.
 */
export function compileConfigSchema(strategy: ChunkingStrategy): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = {};
  for (const field of strategy.configSchema()) {
    shape[field.key] = fieldToZod(field).default(field.default as never);
  }
  return z.object(shape) as z.ZodType<Record<string, unknown>>;
}

/** Validates + normalizes a raw client config for the given strategy. */
export function resolveConfig(strategy: ChunkingStrategy, raw: unknown): Record<string, unknown> {
  const parsed = compileConfigSchema(strategy).safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  // Whole object malformed (e.g. not an object) — fall back to pure defaults.
  const defaults: Record<string, unknown> = {};
  for (const field of strategy.configSchema()) defaults[field.key] = field.default;
  return defaults;
}
