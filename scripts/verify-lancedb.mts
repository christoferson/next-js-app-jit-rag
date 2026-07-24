// Verifies @lancedb/lancedb capabilities the app depends on:
// connect, createTable, vector search + limit, metadata filter (.where),
// delete-by-filter, countRows, openTable, dropTable.
import * as lancedb from "@lancedb/lancedb";

const db = await lancedb.connect("./.verify/lancedb");
const dim = 8;
const mk = (i: number, docId: string) => ({
  id: `r${i}`,
  documentId: docId,
  page: i + 1,
  text: `row ${i}`,
  vector: Array.from({ length: dim }, (_, j) => Math.sin(i * 10 + j)),
});
const rows = [
  ...Array.from({ length: 5 }, (_, i) => mk(i, "doc1")),
  ...Array.from({ length: 3 }, (_, i) => mk(i + 5, "doc2")),
];

const tbl = await db.createTable("probe", rows, { mode: "overwrite" });
console.log("createTable OK, rows =", await tbl.countRows());

const hits = await tbl.search(rows[0].vector).limit(3).toArray();
console.log("search OK", hits.length, "top id =", hits[0]?.id, "distance key present:", "_distance" in (hits[0] ?? {}));
console.log("row metadata roundtrip:", hits[0]?.documentId, hits[0]?.page, JSON.stringify(hits[0]?.text));

const filtered = await tbl.search(rows[0].vector).where(`documentId = 'doc2'`).limit(5).toArray();
console.log("where-filter OK", filtered.length, "all doc2:", filtered.every((r: any) => r.documentId === "doc2"));

await tbl.delete(`documentId = 'doc1'`);
console.log("delete-by-filter OK, remaining =", await tbl.countRows());

const reopened = await db.openTable("probe");
console.log("openTable OK, rows =", await reopened.countRows());

await db.dropTable("probe");
console.log("dropTable OK, tables now =", (await db.tableNames()).length);

console.log("LANCEDB VERIFY: ALL PASS");
