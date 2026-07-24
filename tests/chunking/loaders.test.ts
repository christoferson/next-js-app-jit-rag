import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TextLoader } from "@/lib/chunking/loaders/text-loader";
import { PdfLoader } from "@/lib/chunking/loaders/pdf-loader";
import { getLoader, SUPPORTED_FILE_TYPES } from "@/lib/chunking/loaders/registry";
import { EmptyDocument, LoaderError, UnsupportedFileType } from "@/lib/errors/errors";

const fixture = (name: string) => readFileSync(path.join(__dirname, "..", "fixtures", name));

describe("TextLoader (defensive matrix)", () => {
  const loader = new TextLoader();

  it("valid.txt → paragraphs with text", async () => {
    const els = await loader.load(fixture("valid.txt"));
    expect(els.length).toBeGreaterThan(1);
    expect(els[0].kind).toBe("paragraph");
    expect(els[0].text).toContain("quick brown fox");
  });

  it("empty.txt → EmptyDocument", async () => {
    await expect(loader.load(fixture("empty.txt"))).rejects.toThrow(EmptyDocument);
  });

  it("whitespace.txt → EmptyDocument", async () => {
    await expect(loader.load(fixture("whitespace.txt"))).rejects.toThrow(EmptyDocument);
  });

  it("latin1.txt → decoded via fallback, never an uncaught decode throw", async () => {
    const els = await loader.load(fixture("latin1.txt"));
    expect(els.length).toBeGreaterThan(0);
    expect(els[0].text.length).toBeGreaterThan(10);
  });

  it("mislabeled.txt (binary) → LoaderError, no crash", async () => {
    await expect(loader.load(fixture("mislabeled.txt"))).rejects.toThrow(LoaderError);
  });
});

describe("PdfLoader (defensive matrix)", () => {
  const loader = new PdfLoader();

  it("valid.pdf → one page element per page with page metadata", async () => {
    const els = await loader.load(fixture("valid.pdf"));
    expect(els).toHaveLength(3);
    expect(els.every((e) => e.kind === "page")).toBe(true);
    expect(els.map((e) => e.metadata.page)).toEqual([1, 2, 3]);
    expect(els[1].text).toContain("rollback");
  });

  it("corrupt.pdf → LoaderError with readable reason, no crash", async () => {
    await expect(loader.load(fixture("corrupt.pdf"))).rejects.toThrow(LoaderError);
  });

  it("image-only.pdf → LoaderError('no extractable text')", async () => {
    await expect(loader.load(fixture("image-only.pdf"))).rejects.toThrow(/no extractable text/);
  });

  it("empty buffer → EmptyDocument", async () => {
    await expect(loader.load(Buffer.alloc(0))).rejects.toThrow(EmptyDocument);
  });
});

describe("loader registry", () => {
  it("resolves loaders by file type", () => {
    expect(getLoader("txt")).toBeInstanceOf(TextLoader);
    expect(getLoader("md")).toBeInstanceOf(TextLoader);
    expect(getLoader("pdf")).toBeInstanceOf(PdfLoader);
  });

  it("unknown type → UnsupportedFileType", () => {
    expect(() => getLoader("exe")).toThrow(UnsupportedFileType);
  });

  it("supported types cover the spec set", () => {
    expect(SUPPORTED_FILE_TYPES).toEqual(expect.arrayContaining(["txt", "md", "csv", "pdf"]));
  });
});
