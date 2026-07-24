import type { Chunk, ChunkingStrategy, ParsedElement, StrategyConfigField } from "../types";
import { flattenElements, metadataAt } from "../flatten";

const APPROX_CHARS_PER_TOKEN = 4;

export class FixedSizeStrategy implements ChunkingStrategy {
  id = "fixed_size";
  displayName = "Fixed size";
  description = "Sliding window of a fixed size with overlap; splits across element boundaries.";

  applicableTo(): boolean {
    return true; // all file types
  }

  configSchema(): StrategyConfigField[] {
    return [
      {
        key: "size",
        label: "Chunk size",
        type: "number",
        default: 1000,
        min: 50,
        max: 8000,
        step: 50,
        help: "Window length per chunk, in the selected unit.",
      },
      {
        key: "overlap",
        label: "Overlap",
        type: "number",
        default: 100,
        min: 0,
        max: 2000,
        step: 10,
        help: "How much of the previous chunk is carried into the next.",
      },
      {
        key: "unit",
        label: "Unit",
        type: "select",
        default: "chars",
        options: [
          { value: "chars", label: "Characters" },
          { value: "tokens", label: "Tokens (approx. 4 chars each)" },
        ],
      },
    ];
  }

  chunk(elements: ParsedElement[], config: Record<string, unknown>): Chunk[] {
    const unit = config.unit === "tokens" ? "tokens" : "chars";
    const factor = unit === "tokens" ? APPROX_CHARS_PER_TOKEN : 1;
    const size = Math.max(1, Number(config.size ?? 1000)) * factor;
    let overlap = Math.max(0, Number(config.overlap ?? 100)) * factor;
    if (overlap >= size) overlap = size - 1; // guarantee forward progress

    const doc = flattenElements(elements);
    if (doc.text.trim().length === 0) return [];

    const chunks: Chunk[] = [];
    const step = size - overlap;
    for (let start = 0; start < doc.text.length; start += step) {
      const end = Math.min(start + size, doc.text.length);
      const text = doc.text.slice(start, end);
      if (text.trim().length === 0) continue;
      chunks.push({
        ordinal: chunks.length,
        text,
        metadata: { ...metadataAt(doc, start), charStart: start, charEnd: end },
      });
      if (end >= doc.text.length) break;
    }
    return chunks;
  }
}
