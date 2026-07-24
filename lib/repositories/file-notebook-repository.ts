import type { Notebook, NotebookRepository } from "./types";
import {
  listDirs,
  notebookDir,
  notebookMetaPath,
  readJson,
  removeDir,
  userDir,
  withFileLock,
  writeJsonAtomic,
} from "./fs-util";
import path from "node:path";

export class FileNotebookRepository implements NotebookRepository {
  async save(notebook: Notebook): Promise<void> {
    const file = notebookMetaPath(notebook.userId, notebook.id);
    await withFileLock(file, () => writeJsonAtomic(file, notebook));
  }

  async findById(userId: string, id: string): Promise<Notebook | null> {
    return readJson<Notebook>(notebookMetaPath(userId, id));
  }

  async listByUser(userId: string): Promise<Notebook[]> {
    const base = path.join(userDir(userId), "notebooks");
    const ids = await listDirs(base);
    const notebooks: Notebook[] = [];
    for (const id of ids) {
      const nb = await readJson<Notebook>(notebookMetaPath(userId, id));
      if (nb) notebooks.push(nb);
    }
    return notebooks.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Removes the whole notebook dir: metadata + documents + lancedb + uploads. */
  async delete(userId: string, id: string): Promise<void> {
    await removeDir(notebookDir(userId, id));
  }
}
