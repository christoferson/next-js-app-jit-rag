// LanceDB implementation of VectorStore. API surface verified in scripts/verify-lancedb.mts
// (createTable/openTable/search().where().limit()/delete/dropTable — see VERIFICATION.md §1.1).
// One LanceDB directory per notebook, single "chunks" table inside it.
import * as lancedb from "@lancedb/lancedb";
import type { SearchHit, SearchOptions, VectorRow, VectorStore } from "./vector-store";
import { lancedbDir } from "../repositories/fs-util";

const TABLE = "chunks";

interface StoredRow {
  id: string;
  documentId: string;
  ordinal: number;
  text: string;
  vector: number[];
  /** JSON-encoded provenance (LanceDB columns are flat; nested objects would fix a schema) */
  metadataJson: string;
  page: number; // -1 when absent; kept as a real column for filtering later
  [key: string]: unknown;
}

function toStored(row: VectorRow): StoredRow {
  return {
    id: row.id,
    documentId: row.documentId,
    ordinal: row.ordinal,
    text: row.text,
    vector: row.vector,
    metadataJson: JSON.stringify(row.metadata ?? {}),
    page: typeof row.metadata?.page === "number" ? row.metadata.page : -1,
  };
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

export class LanceDBVectorStore implements VectorStore {
  private connections = new Map<string, Promise<lancedb.Connection>>();

  private connect(userId: string, notebookId: string): Promise<lancedb.Connection> {
    const dir = lancedbDir(userId, notebookId);
    let conn = this.connections.get(dir);
    if (!conn) {
      conn = lancedb.connect(dir);
      this.connections.set(dir, conn);
    }
    return conn;
  }

  private async openTable(userId: string, notebookId: string): Promise<lancedb.Table | null> {
    const db = await this.connect(userId, notebookId);
    const names = await db.tableNames();
    if (!names.includes(TABLE)) return null;
    return db.openTable(TABLE);
  }

  async ensureCollection(): Promise<void> {
    // LanceDB creates the table lazily on first add (schema inferred from rows).
    // Nothing to provision up front; dim is enforced by EmbeddingService + add().
  }

  async add(userId: string, notebookId: string, dim: number, rows: VectorRow[]): Promise<void> {
    if (rows.length === 0) return;
    for (const row of rows) {
      if (row.vector.length !== dim) {
        throw new Error(`vector length ${row.vector.length} != collection dim ${dim}`);
      }
    }
    const db = await this.connect(userId, notebookId);
    const stored = rows.map(toStored);
    const names = await db.tableNames();
    if (!names.includes(TABLE)) {
      await db.createTable(TABLE, stored);
    } else {
      const tbl = await db.openTable(TABLE);
      await tbl.add(stored);
    }
  }

  async search(
    userId: string,
    notebookId: string,
    queryVector: number[],
    options: SearchOptions
  ): Promise<SearchHit[]> {
    const tbl = await this.openTable(userId, notebookId);
    if (!tbl) return [];
    let query = tbl.vectorSearch(queryVector).distanceType("cosine").limit(options.topK);
    if (options.documentId) {
      query = query.where(`documentId = '${escapeSql(options.documentId)}'`);
    }
    const rows = (await query.toArray()) as (StoredRow & { _distance: number })[];
    const hits: SearchHit[] = rows.map((r) => {
      let metadata: SearchHit["metadata"] = {};
      try {
        metadata = JSON.parse(r.metadataJson ?? "{}");
      } catch {
        // tolerate a bad row rather than failing the query
      }
      return {
        id: r.id,
        documentId: r.documentId,
        ordinal: r.ordinal,
        text: r.text,
        score: 1 - r._distance, // cosine similarity in [0,1] (verified probe)
        metadata,
      };
    });
    const threshold = options.scoreThreshold ?? 0;
    return hits.filter((h) => h.score >= threshold);
  }

  async deleteByDocument(userId: string, notebookId: string, documentId: string): Promise<void> {
    const tbl = await this.openTable(userId, notebookId);
    if (!tbl) return;
    await tbl.delete(`documentId = '${escapeSql(documentId)}'`);
  }

  async dropCollection(userId: string, notebookId: string): Promise<void> {
    const dir = lancedbDir(userId, notebookId);
    const tbl = await this.openTable(userId, notebookId).catch(() => null);
    if (tbl) {
      const db = await this.connect(userId, notebookId);
      await db.dropTable(TABLE).catch(() => {});
    }
    this.connections.delete(dir);
  }

  async countRows(userId: string, notebookId: string): Promise<number> {
    const tbl = await this.openTable(userId, notebookId);
    if (!tbl) return 0;
    return tbl.countRows();
  }
}
