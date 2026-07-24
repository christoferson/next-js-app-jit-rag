// Shared helper for strategies that slide over the whole document text:
// flattens ParsedElement[] into one string plus a span map, so a chunk's
// charStart/charEnd are document-global and its page can be recovered.
import type { ParsedElement } from "./types";

export interface ElementSpan {
  start: number;
  end: number;
  metadata: Record<string, unknown>;
}

export interface FlatDocument {
  text: string;
  spans: ElementSpan[];
}

export const ELEMENT_JOINER = "\n\n";

export function flattenElements(elements: ParsedElement[]): FlatDocument {
  let text = "";
  const spans: ElementSpan[] = [];
  for (const el of elements) {
    if (el.text.length === 0) continue;
    if (text.length > 0) text += ELEMENT_JOINER;
    const start = text.length;
    text += el.text;
    spans.push({ start, end: text.length, metadata: el.metadata });
  }
  return { text, spans };
}

/** Metadata of the element containing `offset` (e.g. { page }) — used to stamp chunk provenance. */
export function metadataAt(doc: FlatDocument, offset: number): Record<string, unknown> {
  for (const span of doc.spans) {
    if (offset >= span.start && offset < span.end) return span.metadata;
  }
  return doc.spans.length > 0 ? doc.spans[doc.spans.length - 1].metadata : {};
}
