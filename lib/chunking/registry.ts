// Strategy Registry — adding a strategy = one class + ONE entry here (+ optional default-map line).
import type { ChunkingStrategy } from "./types";
import { FixedSizeStrategy } from "./strategies/fixed-size";
import { RecursiveStrategy } from "./strategies/recursive";
import { DelimiterStrategy } from "./strategies/delimiter";
import { PdfOnePerPageStrategy } from "./strategies/pdf-one-per-page";

export const CHUNKING_STRATEGIES: ChunkingStrategy[] = [
  new FixedSizeStrategy(),
  new RecursiveStrategy(),
  new DelimiterStrategy(),
  new PdfOnePerPageStrategy(),
];

/** Default strategy per file type (auto mode). */
export const DEFAULT_STRATEGY_BY_TYPE: Record<string, string> = {
  txt: "recursive",
  md: "recursive",
  pdf: "pdf_one_per_page",
  csv: "delimiter",
  // pptx: 'pptx_one_per_slide',  // later
  // xlsx: 'excel_one_per_row',   // later
};
