import { promises as fs } from "node:fs";
import path from "node:path";
import type { Uploader } from "./uploader";
import { dataDir, uploadsDir } from "../repositories/fs-util";
import { InvalidPath } from "../errors/errors";

export class LocalDiskUploader implements Uploader {
  async store(userId: string, notebookId: string, fileName: string, data: Buffer): Promise<string> {
    // sanitize the file name; uniqueness comes from the caller's prefix (docId)
    const safe = fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(-120);
    const dir = uploadsDir(userId, notebookId);
    await fs.mkdir(dir, { recursive: true });
    const full = path.join(dir, safe);
    await fs.writeFile(full, data);
    return path.relative(dataDir(), full);
  }

  async read(storagePath: string): Promise<Buffer> {
    const full = path.resolve(dataDir(), storagePath);
    if (!full.startsWith(dataDir() + path.sep)) throw new InvalidPath(storagePath);
    return fs.readFile(full);
  }

  async remove(storagePath: string): Promise<void> {
    const full = path.resolve(dataDir(), storagePath);
    if (!full.startsWith(dataDir() + path.sep)) throw new InvalidPath(storagePath);
    await fs.rm(full, { force: true });
  }
}
