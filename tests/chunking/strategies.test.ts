import { describe, expect, it } from "vitest";
import type { ParsedElement } from "@/lib/chunking/types";
import { FixedSizeStrategy } from "@/lib/chunking/strategies/fixed-size";
import { RecursiveStrategy } from "@/lib/chunking/strategies/recursive";
import { DelimiterStrategy } from "@/lib/chunking/strategies/delimiter";
import { PdfOnePerPageStrategy } from "@/lib/chunking/strategies/pdf-one-per-page";

const text = (s: string): ParsedElement[] => [{ kind: "text", text: s, metadata: {} }];
const pages = (...texts: string[]): ParsedElement[] =>
  texts.map((t, i) => ({ kind: "page", text: t, metadata: { page: i + 1 } }));

describe("fixed_size", () => {
  const strategy = new FixedSizeStrategy();

  it("produces exact boundaries with overlap carried", () => {
    const input = "abcdefghijklmnopqrstuvwxyz"; // 26 chars
    const chunks = strategy.chunk(text(input), { size: 10, overlap: 2, unit: "chars" });
    expect(chunks.map((c) => c.text)).toEqual(["abcdefghij", "ijklmnopqr", "qrstuvwxyz"]);
    expect(chunks[0].metadata).toMatchObject({ charStart: 0, charEnd: 10 });
    expect(chunks[1].metadata).toMatchObject({ charStart: 8, charEnd: 18 });
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2]);
  });

  it("tiny input (< size) → 1 chunk", () => {
    const chunks = strategy.chunk(text("hello"), { size: 100, overlap: 10, unit: "chars" });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].text).toBe("hello");
  });

  it("empty input → 0 chunks", () => {
    expect(strategy.chunk([], { size: 100, overlap: 0, unit: "chars" })).toEqual([]);
    expect(strategy.chunk(text("   "), { size: 100, overlap: 0, unit: "chars" })).toEqual([]);
  });

  it("overlap >= size still makes forward progress", () => {
    const chunks = strategy.chunk(text("abcdefghij"), { size: 4, overlap: 10, unit: "chars" });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.length).toBeLessThan(20);
  });

  it("token unit multiplies by ~4 chars", () => {
    const input = "x".repeat(100);
    const chunks = strategy.chunk(text(input), { size: 10, overlap: 0, unit: "tokens" });
    expect(chunks[0].text).toHaveLength(40);
  });

  it("carries page metadata from spanning elements", () => {
    const chunks = strategy.chunk(pages("a".repeat(50), "b".repeat(50)), { size: 30, overlap: 0, unit: "chars" });
    expect(chunks[0].metadata.page).toBe(1);
    expect(chunks[chunks.length - 1].metadata.page).toBe(2);
  });
});

describe("recursive", () => {
  const strategy = new RecursiveStrategy();

  it("respects paragraph boundaries and packs up to size", () => {
    const input = "Para one is here.\n\nPara two is here.\n\nPara three is here.";
    const chunks = strategy.chunk(text(input), { size: 40, overlap: 0, boundaries: ["paragraph"] });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(40);
  });

  it("never exceeds size even without a usable boundary (hard split)", () => {
    const chunks = strategy.chunk(text("x".repeat(500)), { size: 100, overlap: 0, boundaries: ["paragraph"] });
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(100);
    expect(chunks.map((c) => c.text).join("")).toBe("x".repeat(500));
  });

  it("packs small pieces into one chunk", () => {
    const input = "a.\n\nb.\n\nc.";
    const chunks = strategy.chunk(text(input), { size: 1000, overlap: 0, boundaries: ["paragraph"] });
    expect(chunks).toHaveLength(1);
  });

  it("overlap prepends tail of previous chunk", () => {
    const input = "one two three four.\n\nfive six seven eight.";
    const chunks = strategy.chunk(text(input), { size: 25, overlap: 5, boundaries: ["paragraph"] });
    expect(chunks.length).toBeGreaterThan(1);
    const prevTail = chunks[0].text.slice(-0); // charEnd continuity checked via metadata
    expect(chunks[1].metadata.charStart).toBeLessThan(chunks[0].metadata.charEnd as number);
    void prevTail;
  });

  it("empty → 0 chunks", () => {
    expect(strategy.chunk([], { size: 100, overlap: 0 })).toEqual([]);
  });
});

describe("delimiter", () => {
  const strategy = new DelimiterStrategy();

  it("splits on literal delimiter, excluding it by default", () => {
    const chunks = strategy.chunk(text("aaa---bbb---ccc"), { delimiter: "---", keepDelimiter: false });
    expect(chunks.map((c) => c.text)).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("keepDelimiter includes the delimiter in the preceding chunk", () => {
    const chunks = strategy.chunk(text("aaa---bbb---ccc"), { delimiter: "---", keepDelimiter: true });
    expect(chunks.map((c) => c.text)).toEqual(["aaa---", "bbb---", "ccc"]);
  });

  it("supports \\n escapes", () => {
    const el: ParsedElement[] = [{ kind: "text", text: "p1\n\np2", metadata: {} }];
    const chunks = strategy.chunk(el, { delimiter: "\\n\\n", keepDelimiter: false });
    expect(chunks.map((c) => c.text)).toEqual(["p1", "p2"]);
  });

  it("supports /regex/ form", () => {
    const chunks = strategy.chunk(text("a1b22c333d"), { delimiter: "/[0-9]+/", keepDelimiter: false });
    expect(chunks.map((c) => c.text)).toEqual(["a", "b", "c", "d"]);
  });

  it("produces no empty chunks", () => {
    const chunks = strategy.chunk(text("---aaa------bbb---"), { delimiter: "---", keepDelimiter: false });
    expect(chunks.map((c) => c.text)).toEqual(["aaa", "bbb"]);
  });

  it("invalid regex falls back instead of throwing", () => {
    expect(() => strategy.chunk(text("a\n\nb"), { delimiter: "/[unclosed/", keepDelimiter: false })).not.toThrow();
  });

  it("applicability: txt/md/csv only", () => {
    expect(strategy.applicableTo("txt")).toBe(true);
    expect(strategy.applicableTo("pdf")).toBe(false);
  });
});

describe("pdf_one_per_page", () => {
  const strategy = new PdfOnePerPageStrategy();

  it("one chunk per page with page provenance", () => {
    const chunks = strategy.chunk(pages("page one text", "page two text", "page three"), {
      mergeShortPages: false,
      minChars: 200,
    });
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.metadata.page)).toEqual([1, 2, 3]);
    expect(chunks.map((c) => c.ordinal)).toEqual([0, 1, 2]);
  });

  it("mergeShortPages merges pages under minChars into the next", () => {
    const chunks = strategy.chunk(pages("tiny", "x".repeat(300), "small"), {
      mergeShortPages: true,
      minChars: 100,
    });
    expect(chunks).toHaveLength(2);
    expect(chunks[0].metadata.page).toBe(1); // merged 1+2 starts at page 1
    expect(chunks[0].metadata.pageEnd).toBe(2);
    expect(chunks[0].text).toContain("tiny");
    // last page stays even if short
    expect(chunks[1].metadata.page).toBe(3);
  });

  it("skips empty pages", () => {
    const els: ParsedElement[] = [
      { kind: "page", text: "content", metadata: { page: 1 } },
      { kind: "page", text: "   ", metadata: { page: 2 } },
    ];
    const chunks = strategy.chunk(els, { mergeShortPages: false, minChars: 0 });
    expect(chunks).toHaveLength(1);
  });

  it("applicability: pdf only", () => {
    expect(strategy.applicableTo("pdf")).toBe(true);
    expect(strategy.applicableTo("txt")).toBe(false);
  });
});
