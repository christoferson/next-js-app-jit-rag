// NotebookService — lifecycle + model-immutability enforcement.
import { randomUUID } from "node:crypto";
import type { DocumentRepository, Notebook, NotebookRepository } from "../repositories/types";
import type { VectorStore } from "../adapters/vector-store";
import type { Uploader } from "../adapters/uploader";
import { getEmbeddingModel } from "../models/factory";
import { ModelLocked, NotebookNotFound } from "../errors/errors";

export class NotebookService {
  constructor(
    private readonly notebooks: NotebookRepository,
    private readonly documents: DocumentRepository,
    private readonly vectors: VectorStore,
    private readonly uploader: Uploader
  ) {}

  async create(userId: string, name: string, embeddingModelId: string): Promise<Notebook> {
    const model = getEmbeddingModel(embeddingModelId); // throws ModelNotFound
    const notebook: Notebook = {
      id: `nb_${randomUUID()}`,
      userId,
      name,
      embeddingModelId: model.id,
      dim: model.dim, // dim FIXED at creation from the registry — never hardcoded
      createdAt: new Date().toISOString(),
    };
    await this.notebooks.save(notebook);
    return notebook;
  }

  async get(userId: string, id: string): Promise<Notebook> {
    const notebook = await this.notebooks.findById(userId, id);
    if (!notebook) throw new NotebookNotFound(id);
    return notebook;
  }

  async list(userId: string): Promise<(Notebook & { docCount: number })[]> {
    const notebooks = await this.notebooks.listByUser(userId);
    return Promise.all(
      notebooks.map(async (nb) => ({
        ...nb,
        docCount: (await this.documents.listByNotebook(userId, nb.id)).length,
      }))
    );
  }

  /** Model is immutable once the notebook has any documents. */
  async assertModelUnlockedOrSame(userId: string, notebookId: string, embeddingModelId: string): Promise<void> {
    const notebook = await this.get(userId, notebookId);
    if (embeddingModelId === notebook.embeddingModelId) return;
    const docs = await this.documents.listByNotebook(userId, notebookId);
    if (docs.length > 0) throw new ModelLocked(notebookId);
  }

  /** Rename and/or change the embedding model. Model change is rejected once documents exist. */
  async update(userId: string, id: string, patch: { name?: string; embeddingModelId?: string }): Promise<Notebook> {
    const notebook = await this.get(userId, id);
    let next = { ...notebook };
    if (patch.name !== undefined) next = { ...next, name: patch.name };
    if (patch.embeddingModelId !== undefined && patch.embeddingModelId !== notebook.embeddingModelId) {
      await this.assertModelUnlockedOrSame(userId, id, patch.embeddingModelId);
      const model = getEmbeddingModel(patch.embeddingModelId);
      next = { ...next, embeddingModelId: model.id, dim: model.dim };
    }
    await this.notebooks.save(next);
    return next;
  }

  /** Explicit delete: metadata + documents + LanceDB table + uploads (entire dir). */
  async delete(userId: string, id: string): Promise<void> {
    await this.get(userId, id); // 404 if unknown/not owned
    await this.vectors.dropCollection(userId, id).catch(() => {});
    await this.notebooks.delete(userId, id); // removes the whole notebook dir incl. lancedb/ + uploads/
  }
}
