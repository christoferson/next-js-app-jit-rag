// ChunkingService — strategy selection (explicit vs default-by-type) + config resolution.
// Pure delegation to the Strategy registry/factory; no chunking logic here.
import type { Chunk, ChunkingStrategy, ParsedElement } from "../chunking/types";
import { resolveConfig, selectStrategy } from "../chunking/factory";

export interface ChunkingSelection {
  strategy: ChunkingStrategy;
  config: Record<string, unknown>;
}

export class ChunkingService {
  /**
   * mode 'auto' → default strategy for the file type; 'custom' → explicit strategyId.
   * Config is validated/clamped against the strategy's own configSchema either way.
   */
  select(fileType: string, mode: "auto" | "custom", strategyId?: string, rawConfig?: unknown): ChunkingSelection {
    const strategy = selectStrategy(fileType, mode === "custom" ? strategyId : undefined);
    const config = resolveConfig(strategy, rawConfig);
    return { strategy, config };
  }

  chunk(selection: ChunkingSelection, elements: ParsedElement[]): Chunk[] {
    return selection.strategy.chunk(elements, selection.config);
  }
}
