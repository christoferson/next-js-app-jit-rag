import type { ParsedElement } from "../types";

/** Loader: raw file bytes → ParsedElement[]. Defensive: throws only typed AppErrors. */
export interface Loader {
  /** file extensions (lowercase, no dot) this loader handles */
  fileTypes: string[];
  load(buffer: Buffer, fileName: string): Promise<ParsedElement[]>;
}
