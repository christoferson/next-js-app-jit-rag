import type { Loader } from "./types";
import type { ParsedElement } from "../types";
import { EmptyDocument, LoaderError } from "../../errors/errors";

// pdfjs-dist legacy build works in Node without a worker.
// Options verified in scripts/verify-loaders.mts (see VERIFICATION.md §1.3).
export class PdfLoader implements Loader {
  fileTypes = ["pdf"];

  async load(buffer: Buffer): Promise<ParsedElement[]> {
    if (buffer.length === 0) throw new EmptyDocument();

    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    let task: ReturnType<typeof pdfjs.getDocument> | undefined;
    try {
      task = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        useWorkerFetch: false,
        standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/",
      });
      const doc = await task.promise;

      const elements: ParsedElement[] = [];
      for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
        const page = await doc.getPage(pageNum);
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ("str" in item ? item.str : ""))
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (text.length > 0) {
          elements.push({ kind: "page", text, metadata: { page: pageNum } });
        }
        page.cleanup();
      }

      if (elements.length === 0) throw new LoaderError("no extractable text (image-only or empty PDF)");
      return elements;
    } catch (err) {
      if (err instanceof LoaderError || err instanceof EmptyDocument) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new LoaderError(`Could not parse PDF: ${message}`);
    } finally {
      await task?.destroy().catch(() => {});
    }
  }
}
