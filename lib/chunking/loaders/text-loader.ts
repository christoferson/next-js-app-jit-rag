import chardet from "chardet";
import iconv from "iconv-lite";
import type { Loader } from "./types";
import type { ParsedElement } from "../types";
import { EmptyDocument, LoaderError } from "../../errors/errors";

/** Rough binary sniff: NUL bytes or a high ratio of control chars → not text. */
function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious++;
  }
  return sample.length > 0 && suspicious / sample.length > 0.1;
}

export class TextLoader implements Loader {
  fileTypes = ["txt", "md", "csv"];

  async load(buffer: Buffer): Promise<ParsedElement[]> {
    if (buffer.length === 0) throw new EmptyDocument();
    if (looksBinary(buffer)) throw new LoaderError("File does not appear to be text (binary content detected).");

    let text: string;
    try {
      const encoding = chardet.detect(buffer) ?? "utf-8";
      text = iconv.encodingExists(encoding) ? iconv.decode(buffer, encoding) : buffer.toString("utf-8");
    } catch {
      throw new LoaderError("Could not decode file as text (unknown encoding).");
    }

    text = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
    if (text.trim().length === 0) throw new EmptyDocument();

    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    return paragraphs.map((p) => ({ kind: "paragraph" as const, text: p, metadata: {} }));
  }
}
