import type { Chunk, ChunkingStrategy, ParsedElement, StrategyConfigField } from "../types";

export class PdfOnePerPageStrategy implements ChunkingStrategy {
  id = "pdf_one_per_page";
  displayName = "One chunk per page";
  description = "One chunk per PDF page, with page-number provenance; optionally merges short pages.";

  applicableTo(fileType: string): boolean {
    return fileType === "pdf";
  }

  configSchema(): StrategyConfigField[] {
    return [
      {
        key: "mergeShortPages",
        label: "Merge short pages",
        type: "boolean",
        default: false,
        help: "Pages shorter than the minimum are merged into the following page.",
      },
      {
        key: "minChars",
        label: "Minimum per page",
        type: "number",
        default: 200,
        min: 0,
        max: 5000,
        step: 50,
        unit: "chars",
      },
    ];
  }

  chunk(elements: ParsedElement[], config: Record<string, unknown>): Chunk[] {
    const merge = config.mergeShortPages === true;
    const minChars = Math.max(0, Number(config.minChars ?? 200));

    const pages = elements.filter((el) => el.kind === "page" && el.text.trim().length > 0);
    const chunks: Chunk[] = [];
    let carryText = "";
    let carryPage: number | undefined;

    for (let i = 0; i < pages.length; i++) {
      const el = pages[i];
      const page = typeof el.metadata.page === "number" ? el.metadata.page : i + 1;
      const text = carryText.length > 0 ? `${carryText}\n\n${el.text}` : el.text;
      const firstPage = carryPage ?? page;
      const isLast = i === pages.length - 1;

      if (merge && text.length < minChars && !isLast) {
        carryText = text;
        carryPage = firstPage;
        continue;
      }
      carryText = "";
      carryPage = undefined;
      chunks.push({
        ordinal: chunks.length,
        text,
        metadata: {
          ...el.metadata,
          page: firstPage,
          ...(firstPage !== page ? { pageEnd: page } : {}),
        },
      });
    }
    return chunks;
  }
}
