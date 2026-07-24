import { describe, expect, it } from "vitest";
import { compileConfigSchema, getStrategy, resolveConfig, selectStrategy, strategiesFor } from "@/lib/chunking/factory";
import { CHUNKING_STRATEGIES, DEFAULT_STRATEGY_BY_TYPE } from "@/lib/chunking/registry";
import { StrategyNotApplicable, StrategyNotFound, UnsupportedFileType } from "@/lib/errors/errors";

describe("registry", () => {
  it("has the four seed strategies with unique ids", () => {
    const ids = CHUNKING_STRATEGIES.map((s) => s.id);
    expect(ids).toContain("fixed_size");
    expect(ids).toContain("recursive");
    expect(ids).toContain("delimiter");
    expect(ids).toContain("pdf_one_per_page");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("default map points only at registered strategies", () => {
    for (const id of Object.values(DEFAULT_STRATEGY_BY_TYPE)) {
      expect(() => getStrategy(id)).not.toThrow();
    }
  });
});

describe("factory", () => {
  it("resolves by id and throws StrategyNotFound for unknown", () => {
    expect(getStrategy("recursive").id).toBe("recursive");
    expect(() => getStrategy("nope")).toThrow(StrategyNotFound);
  });

  it("selects explicit strategy when applicable", () => {
    expect(selectStrategy("txt", "fixed_size").id).toBe("fixed_size");
  });

  it("rejects explicit strategy not applicable to file type", () => {
    expect(() => selectStrategy("txt", "pdf_one_per_page")).toThrow(StrategyNotApplicable);
  });

  it("falls back to default-by-type", () => {
    expect(selectStrategy("pdf").id).toBe("pdf_one_per_page");
    expect(selectStrategy("txt").id).toBe("recursive");
  });

  it("throws for unsupported file type with no default", () => {
    expect(() => selectStrategy("exe")).toThrow(UnsupportedFileType);
  });

  it("strategiesFor filters by applicability", () => {
    const pdfIds = strategiesFor("pdf").map((s) => s.id);
    expect(pdfIds).toContain("pdf_one_per_page");
    expect(pdfIds).not.toContain("delimiter");
  });
});

describe("config compilation (zod from configSchema)", () => {
  it("fills defaults for missing fields", () => {
    const config = resolveConfig(getStrategy("fixed_size"), {});
    expect(config).toMatchObject({ size: 1000, overlap: 100, unit: "chars" });
  });

  it("strips unknown fields", () => {
    const config = resolveConfig(getStrategy("fixed_size"), { size: 500, evil: "x" });
    expect(config.size).toBe(500);
    expect("evil" in config).toBe(false);
  });

  it("clamps out-of-range numbers", () => {
    const config = resolveConfig(getStrategy("fixed_size"), { size: 999999, overlap: -5 });
    expect(config.size).toBe(8000);
    expect(config.overlap).toBe(0);
  });

  it("invalid select value falls back to default", () => {
    const config = resolveConfig(getStrategy("fixed_size"), { unit: "bogus" });
    expect(config.unit).toBe("chars");
  });

  it("multiselect: fills default, drops unknowns, falls back when empty", () => {
    const rec = getStrategy("recursive");
    expect(resolveConfig(rec, {}).boundaries).toEqual(["paragraph", "line", "sentence", "word"]);
    expect(resolveConfig(rec, { boundaries: ["line", "bogus"] }).boundaries).toEqual(["line"]);
    // empty selection is not allowed to strand the strategy → defaults
    expect(resolveConfig(rec, { boundaries: [] }).boundaries).toEqual(["paragraph", "line", "sentence", "word"]);
    // non-array → defaults
    expect(resolveConfig(rec, { boundaries: "nope" }).boundaries).toEqual(["paragraph", "line", "sentence", "word"]);
  });

  it("non-object config falls back to pure defaults", () => {
    const config = resolveConfig(getStrategy("delimiter"), "garbage");
    expect(config).toMatchObject({ delimiter: "\\n\\n", keepDelimiter: false });
  });

  it("compileConfigSchema exists for every registered strategy", () => {
    for (const s of CHUNKING_STRATEGIES) {
      expect(compileConfigSchema(s).safeParse({}).success).toBe(true);
    }
  });
});
