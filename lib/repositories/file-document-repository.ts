import type { DocumentEntity, DocumentRepository } from "./types";
import { DocumentNotFound } from "../errors/errors";
import {
  documentMetaPath,
  documentsDir,
  listJsonFiles,
  readJson,
  removeFile,
  withFileLock,
  writeJsonAtomic,
} from "./fs-util";

export class FileDocumentRepository implements DocumentRepository {
  async save(doc: DocumentEntity): Promise<void> {
    const file = documentMetaPath(doc.userId, doc.notebookId, doc.id);
    await withFileLock(file, () => writeJsonAtomic(file, doc));
  }

  async findById(userId: string, notebookId: string, id: string): Promise<DocumentEntity | null> {
    return readJson<DocumentEntity>(documentMetaPath(userId, notebookId, id));
  }

  async listByNotebook(userId: string, notebookId: string): Promise<DocumentEntity[]> {
    const files = await listJsonFiles(documentsDir(userId, notebookId));
    const docs: DocumentEntity[] = [];
    for (const f of files) {
      const doc = await readJson<DocumentEntity>(f);
      if (doc) docs.push(doc);
    }
    return docs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async update(
    userId: string,
    notebookId: string,
    id: string,
    mutate: (doc: DocumentEntity) => DocumentEntity
  ): Promise<DocumentEntity> {
    const file = documentMetaPath(userId, notebookId, id);
    return withFileLock(file, async () => {
      const current = await readJson<DocumentEntity>(file);
      if (!current) throw new DocumentNotFound(id);
      const next = { ...mutate(current), updatedAt: new Date().toISOString() };
      await writeJsonAtomic(file, next);
      return next;
    });
  }

  async delete(userId: string, notebookId: string, id: string): Promise<void> {
    await removeFile(documentMetaPath(userId, notebookId, id));
  }
}
