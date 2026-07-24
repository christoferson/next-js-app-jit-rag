// fs utilities for file-based repositories:
// - user-scoped path builders that REFUSE to resolve outside DATA_DIR/users/{userId}
// - atomic JSON write (temp + rename, same volume)
// - per-file async lock (in-process; single-node runtime per SPEC)
import { promises as fs } from "node:fs";
import path from "node:path";
import { Mutex } from "async-mutex";
import { InvalidPath } from "../errors/errors";

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR ?? "./data");
}

/** Allow only ids that can't traverse: alnum, dash, underscore, dot (no path separators, no '..'). */
export function assertSafeSegment(segment: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment) || segment.includes("..")) {
    throw new InvalidPath(segment);
  }
  return segment;
}

export function userDir(userId: string): string {
  return path.join(dataDir(), "users", assertSafeSegment(userId));
}

export function notebookDir(userId: string, notebookId: string): string {
  const dir = path.join(userDir(userId), "notebooks", assertSafeSegment(notebookId));
  // belt & braces: resolved path must stay under the user dir
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(userDir(userId)) + path.sep)) {
    throw new InvalidPath(notebookId);
  }
  return dir;
}

export function notebookMetaPath(userId: string, notebookId: string): string {
  return path.join(notebookDir(userId, notebookId), "notebook.json");
}

export function documentsDir(userId: string, notebookId: string): string {
  return path.join(notebookDir(userId, notebookId), "documents");
}

export function documentMetaPath(userId: string, notebookId: string, docId: string): string {
  return path.join(documentsDir(userId, notebookId), `${assertSafeSegment(docId)}.json`);
}

export function uploadsDir(userId: string, notebookId: string): string {
  return path.join(notebookDir(userId, notebookId), "uploads");
}

export function lancedbDir(userId: string, notebookId: string): string {
  return path.join(notebookDir(userId, notebookId), "lancedb");
}

export function jobsDir(userId: string): string {
  return path.join(userDir(userId), "jobs");
}

export function jobPath(userId: string, jobId: string): string {
  return path.join(jobsDir(userId), `${assertSafeSegment(jobId)}.json`);
}

// ---- per-file lock ----

const locks = new Map<string, Mutex>();

function lockFor(filePath: string): Mutex {
  const key = path.resolve(filePath);
  let mutex = locks.get(key);
  if (!mutex) {
    mutex = new Mutex();
    locks.set(key, mutex);
  }
  return mutex;
}

export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  return lockFor(filePath).runExclusive(fn);
}

// ---- atomic JSON I/O ----

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf-8");
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    // Windows can fail rename onto a file being read; retry once after a tick
    await new Promise((r) => setTimeout(r, 10));
    try {
      await fs.rename(tmp, filePath);
    } catch {
      await fs.rm(tmp, { force: true }).catch(() => {});
      throw err;
    }
  }
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

export async function removeDir(dirPath: string): Promise<void> {
  await fs.rm(dirPath, { recursive: true, force: true });
}

export async function removeFile(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true });
}

export async function listJsonFiles(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath);
    return entries.filter((e) => e.endsWith(".json")).map((e) => path.join(dirPath, e));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

export async function listDirs(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
