import type { Chunk, ChunkingStrategy, ParsedElement, StrategyConfigField } from "../types";
import { flattenElements, metadataAt } from "../flatten";

const DELIMITER_APPLICABLE = new Set(["txt", "md", "csv"]);

export class DelimiterStrategy implements ChunkingStrategy {
  id = "delimiter";
  displayName = "Delimiter";
  description = "Splits on a literal or regex delimiter (e.g. \\n\\n, ---).";

  applicableTo(fileType: string): boolean {
    return DELIMITER_APPLICABLE.has(fileType);
  }

  configSchema(): StrategyConfigField[] {
    return [
      {
        key: "delimiter",
        label: "Delimiter",
        type: "string",
        default: "\\n\\n",
        help: "Literal text (\\n and \\t supported) or /regex/ between slashes.",
      },
      {
        key: "keepDelimiter",
        label: "Keep delimiter in chunk",
        type: "boolean",
        default: false,
      },
    ];
  }

  chunk(elements: ParsedElement[], config: Record<string, unknown>): Chunk[] {
    const rawDelim = typeof config.delimiter === "string" && config.delimiter.length > 0 ? config.delimiter : "\\n\\n";
    const keep = config.keepDelimiter === true;

    const doc = flattenElements(elements);
    if (doc.text.trim().length === 0) return [];

    let matcher: RegExp;
    const regexForm = /^\/(.+)\/([a-z]*)$/.exec(rawDelim);
    try {
      if (regexForm) {
        const flags = regexForm[2].includes("g") ? regexForm[2] : regexForm[2] + "g";
        matcher = new RegExp(regexForm[1], flags);
      } else {
        const literal = rawDelim.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
        matcher = new RegExp(literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      }
    } catch {
      // invalid regex from the user — fall back to literal paragraph split
      matcher = /\n\n/g;
    }

    const chunks: Chunk[] = [];
    let cursor = 0;
    const push = (start: number, end: number) => {
      const text = doc.text.slice(start, end);
      if (text.trim().length === 0) return; // no empty chunks
      chunks.push({
        ordinal: chunks.length,
        text,
        metadata: { ...metadataAt(doc, start), charStart: start, charEnd: end },
      });
    };
    for (const m of doc.text.matchAll(matcher)) {
      const idx = m.index ?? 0;
      if (m[0].length === 0) break; // zero-length match guard
      push(cursor, keep ? idx + m[0].length : idx);
      cursor = idx + m[0].length;
    }
    push(cursor, doc.text.length);
    return chunks;
  }
}
