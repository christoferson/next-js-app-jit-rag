import { promises as fs } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FileNotebookRepository } from "@/lib/repositories/file-notebook-repository";
import { FileDocumentRepository } from "@/lib/repositories/file-document-repository";
import { FileJobRepository } from "@/lib/repositories/file-job-repository";
import { assertSafeSegment, notebookDir, jobPath, readJson } from "@/lib/repositories/fs-util";
import type { DocumentEntity, Job, Notebook } from "@/lib/repositories/types";
import { InvalidPath } from "@/lib/errors/errors";

const TEST_DATA = path.resolve("./.test-data");

beforeAll(async () => {
  process.env.DATA_DIR = TEST_DATA;
  await fs.rm(TEST_DATA, { recursive: true, force: true });
});

afterAll(async () => {
  await fs.rm(TEST_DATA, { recursive: true, force: true });
});

const nb = (id: string): Notebook => ({
  id,
  userId: "u1",
  name: "Test",
  embeddingModelId: "amazon.titan-embed-text-v2:0",
  dim: 1024,
  createdAt: new Date().toISOString(),
});

const doc = (id: string, notebookId: string): DocumentEntity => ({
  id,
  userId: "u1",
  notebookId,
  name: "file.txt",
  fileType: "txt",
  sizeBytes: 10,
  strategyId: "recursive",
  strategyConfig: {},
  status: "queued",
  chunkCount: 0,
  uploadPath: "x",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

const job = (id: string): Job => ({
  id,
  userId: "u1",
  notebookId: "n1",
  documentId: "d1",
  status: "queued",
  phase: "queued",
  processed: 0,
  total: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

describe("path safety (user scoping)", () => {
  it("rejects traversal in ids", () => {
    expect(() => assertSafeSegment("../../etc")).toThrow(InvalidPath);
    expect(() => assertSafeSegment("a/b")).toThrow(InvalidPath);
    expect(() => assertSafeSegment("a\\b")).toThrow(InvalidPath);
    expect(() => assertSafeSegment("..")).toThrow(InvalidPath);
    expect(() => assertSafeSegment(".hidden")).toThrow(InvalidPath);
    expect(() => assertSafeSegment("")).toThrow(InvalidPath);
  });

  it("accepts normal ids and stays under the user dir", () => {
    const dir = notebookDir("u1", "nb_123-abc");
    expect(path.resolve(dir).startsWith(path.join(TEST_DATA, "users", "u1"))).toBe(true);
  });

  it("malicious notebookId cannot escape", () => {
    expect(() => notebookDir("u1", "..")).toThrow(InvalidPath);
    expect(() => notebookDir("u1", "../u2")).toThrow(InvalidPath);
  });
});

describe("FileNotebookRepository", () => {
  const repo = new FileNotebookRepository();

  it("save + findById + listByUser + delete roundtrip", async () => {
    await repo.save(nb("n1"));
    await repo.save(nb("n2"));
    expect((await repo.findById("u1", "n1"))?.id).toBe("n1");
    expect(await repo.findById("u1", "missing")).toBeNull();
    expect((await repo.listByUser("u1")).map((n) => n.id).sort()).toEqual(["n1", "n2"]);
    await repo.delete("u1", "n2");
    expect(await repo.findById("u1", "n2")).toBeNull();
    // dir must be fully gone
    await expect(fs.stat(notebookDir("u1", "n2"))).rejects.toThrow();
  });

  it("other user cannot see the notebook", async () => {
    expect(await repo.findById("u2", "n1")).toBeNull();
    expect(await repo.listByUser("u2")).toEqual([]);
  });
});

describe("FileDocumentRepository", () => {
  const repo = new FileDocumentRepository();

  it("save + list + update + delete", async () => {
    await repo.save(doc("d1", "n1"));
    await repo.save(doc("d2", "n1"));
    expect((await repo.listByNotebook("u1", "n1")).length).toBe(2);
    const updated = await repo.update("u1", "n1", "d1", (d) => ({ ...d, status: "indexed", chunkCount: 5 }));
    expect(updated.status).toBe("indexed");
    expect((await repo.findById("u1", "n1", "d1"))?.chunkCount).toBe(5);
    await repo.delete("u1", "n1", "d2");
    expect(await repo.findById("u1", "n1", "d2")).toBeNull();
  });
});

describe("FileJobRepository — concurrency (§8)", () => {
  const repo = new FileJobRepository();

  it("N parallel updates are all applied (no lost writes)", async () => {
    await repo.save(job("j1"));
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, () => repo.update("u1", "j1", (j) => ({ ...j, processed: j.processed + 1 })))
    );
    const final = await repo.findById("u1", "j1");
    expect(final?.processed).toBe(N);
  });

  it("concurrent read during writes always sees valid JSON (atomic snapshot)", async () => {
    await repo.save(job("j2"));
    const writes = Array.from({ length: 20 }, () =>
      repo.update("u1", "j2", (j) => ({ ...j, processed: j.processed + 1 }))
    );
    const reads = Array.from({ length: 20 }, async () => {
      const parsed = await readJson<Job>(jobPath("u1", "j2"));
      if (parsed !== null) expect(typeof parsed.processed).toBe("number");
    });
    await Promise.all([...writes, ...reads]);
  });

  it("no partial tmp files left behind", async () => {
    const dir = path.dirname(jobPath("u1", "j1"));
    const files = await fs.readdir(dir);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
