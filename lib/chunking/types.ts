// The chunking contract — the interface everything orbits (SPEC §5.1).

export interface ParsedElement {
  /** structural unit emitted by a loader, pre-chunk. 'slide' | 'row' reserved for later loaders. */
  kind: "page" | "paragraph" | "text" | "row";
  text: string;
  /** e.g. { page: 12 } — carried through into chunk provenance */
  metadata: Record<string, unknown>;
}

export interface ChunkMetadata {
  page?: number;
  charStart?: number;
  charEnd?: number;
  [k: string]: unknown;
}

export interface Chunk {
  /** sequence within the document */
  ordinal: number;
  text: string;
  /** provenance → flows into citations */
  metadata: ChunkMetadata;
}

/** Self-describing config field: drives the upload UI controls AND server-side zod validation. */
export interface StrategyConfigField {
  key: string;
  label: string;
  type: "number" | "string" | "boolean" | "select" | "multiselect";
  default: unknown;
  min?: number;
  max?: number;
  step?: number;
  /** shown next to a numeric value, e.g. "chars" — display only, no effect on validation */
  unit?: string;
  options?: { value: string; label: string }[];
  help?: string;
}

export interface ChunkingStrategy {
  id: string; // 'fixed_size'
  displayName: string;
  description: string;
  applicableTo(fileType: string): boolean; // 'txt' | 'pdf' | ...
  configSchema(): StrategyConfigField[];
  chunk(elements: ParsedElement[], config: Record<string, unknown>): Chunk[];
}
