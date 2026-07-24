import type { Chunk, ChunkingStrategy, ParsedElement, StrategyConfigField } from "../types";
import { flattenElements, metadataAt, type FlatDocument } from "../flatten";

const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", " "];

/** Friendly boundary names → the separator string each represents, in ladder order. */
const BOUNDARY_SEPARATORS: Record<string, string> = {
  paragraph: "\n\n",
  line: "\n",
  sentence: ". ",
  word: " ",
};
const BOUNDARY_ORDER = ["paragraph", "line", "sentence", "word"];

interface Piece {
  start: number;
  end: number;
}

/** Splits [start,end) on `sep`, keeping the separator attached to the preceding piece. */
function splitOn(text: string, start: number, end: number, sep: string): Piece[] {
  const pieces: Piece[] = [];
  let cursor = start;
  while (cursor < end) {
    const idx = text.indexOf(sep, cursor);
    if (idx === -1 || idx + sep.length > end) {
      pieces.push({ start: cursor, end });
      break;
    }
    pieces.push({ start: cursor, end: idx + sep.length });
    cursor = idx + sep.length;
  }
  return pieces;
}

/** Recursively splits a span until every piece fits in `size`, descending the separator ladder. */
function splitToFit(text: string, piece: Piece, size: number, separators: string[]): Piece[] {
  if (piece.end - piece.start <= size) return [piece];
  const [sep, ...rest] = separators;
  if (sep === undefined) {
    // no separators left — hard-split
    const out: Piece[] = [];
    for (let s = piece.start; s < piece.end; s += size) {
      out.push({ start: s, end: Math.min(s + size, piece.end) });
    }
    return out;
  }
  const parts = splitOn(text, piece.start, piece.end, sep);
  if (parts.length === 1) return splitToFit(text, piece, size, rest);
  return parts.flatMap((p) => splitToFit(text, p, size, rest));
}

export class RecursiveStrategy implements ChunkingStrategy {
  id = "recursive";
  displayName = "Recursive (smart)";
  description = "Splits on paragraph → sentence → word boundaries, packing pieces up to the target size.";

  applicableTo(): boolean {
    return true; // all file types
  }

  configSchema(): StrategyConfigField[] {
    return [
      {
        key: "size",
        label: "Max chunk size",
        type: "number",
        default: 1200,
        min: 100,
        max: 8000,
        step: 100,
        unit: "chars",
      },
      {
        key: "overlap",
        label: "Overlap",
        type: "number",
        default: 150,
        min: 0,
        max: 2000,
        step: 10,
        unit: "chars",
        help: "Tail of the previous chunk prepended to the next.",
      },
      {
        key: "boundaries",
        label: "Split on boundaries",
        type: "multiselect",
        default: BOUNDARY_ORDER,
        options: [
          { value: "paragraph", label: "Paragraph" },
          { value: "line", label: "Line" },
          { value: "sentence", label: "Sentence" },
          { value: "word", label: "Word" },
        ],
        help: "Tried finest-first from the top down; first boundary that yields pieces under the size wins. Falls back to a hard cut if none fit.",
      },
    ];
  }

  private parseSeparators(config: Record<string, unknown>): string[] {
    const raw = Array.isArray(config.boundaries) ? config.boundaries : [];
    const selected = BOUNDARY_ORDER.filter((b) => raw.includes(b)).map((b) => BOUNDARY_SEPARATORS[b]);
    return selected.length > 0 ? selected : DEFAULT_SEPARATORS;
  }

  chunk(elements: ParsedElement[], config: Record<string, unknown>): Chunk[] {
    const size = Math.max(1, Number(config.size ?? 1200));
    let overlap = Math.max(0, Number(config.overlap ?? 150));
    if (overlap >= size) overlap = Math.floor(size / 4);
    const separators = this.parseSeparators(config);

    const doc = flattenElements(elements);
    if (doc.text.trim().length === 0) return [];

    const pieces = splitToFit(doc.text, { start: 0, end: doc.text.length }, size, separators);

    // Pack consecutive pieces into chunks up to `size` (overlap shrinks capacity after the first chunk).
    const chunks: Chunk[] = [];
    let group: Piece[] = [];
    const flush = () => {
      if (group.length === 0) return;
      this.emit(doc, group, overlap, chunks);
      group = [];
    };
    for (const p of pieces) {
      const groupLen = group.length > 0 ? group[group.length - 1].end - group[0].start : 0;
      const budget = chunks.length > 0 ? size - overlap : size;
      if (group.length > 0 && groupLen + (p.end - p.start) > budget) flush();
      group.push(p);
    }
    flush();
    return chunks;
  }

  private emit(doc: FlatDocument, group: Piece[], overlap: number, chunks: Chunk[]): void {
    const start = group[0].start;
    const end = group[group.length - 1].end;
    const overlapStart = Math.max(0, start - (chunks.length > 0 ? overlap : 0));
    const text = doc.text.slice(overlapStart, end);
    if (text.trim().length === 0) return;
    chunks.push({
      ordinal: chunks.length,
      text,
      metadata: { ...metadataAt(doc, start), charStart: overlapStart, charEnd: end },
    });
  }
}
