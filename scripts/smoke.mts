// End-to-end smoke per CLAUDE.md §9. Requires the dev server running (npm run dev)
// and valid AWS creds. Usage: npx tsx scripts/smoke.mts [baseUrl]
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3000";
let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function json(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
}

async function pollJob(jobId: string, timeoutMs = 120_000): Promise<Record<string, unknown>> {
  const start = Date.now();
  for (;;) {
    const job = await json(await fetch(`${base}/api/jobs/${jobId}`));
    if (job.status === "done" || job.status === "error") return job;
    if (Date.now() - start > timeoutMs) throw new Error(`job ${jobId} timed out in phase ${job.phase}`);
    await new Promise((r) => setTimeout(r, 750));
  }
}

async function collectSse(res: Response): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) !== -1) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = frame.split("\n").find((l) => l.startsWith("data: "))?.slice(6);
      if (data) events.push(JSON.parse(data));
    }
  }
  return events;
}

// --- 1. create notebook ---
const created = await json(
  await fetch(`${base}/api/notebooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Smoke Test", embeddingModelId: "amazon.titan-embed-text-v2:0" }),
  })
);
check("1. create notebook", !!created.id && created.dim === 1024, `id=${created.id} dim=${created.dim}`);
const nbId = created.id as string;

// --- 2. upload valid.pdf (auto) ---
const pdfBytes = readFileSync("tests/fixtures/valid.pdf");
const form = new FormData();
form.append("file", new File([pdfBytes], "valid.pdf", { type: "application/pdf" }));
form.append("chunkingMode", "auto");
const upload = await json(await fetch(`${base}/api/notebooks/${nbId}/documents`, { method: "POST", body: form }));
check("2. upload valid.pdf → 202 jobId", !!upload.jobId && !!upload.documentId, `jobId=${upload.jobId}`);

// --- 3. poll job ---
const job = await pollJob(upload.jobId);
check("3. job done with chunks > 0", job.status === "done" && Number(job.chunks) > 0, `chunks=${job.chunks}`);

// --- 4. open notebook ---
const overview = await json(await fetch(`${base}/api/notebooks/${nbId}`));
const doc0 = overview.documents?.[0];
check(
  "4. document indexed, totals correct",
  doc0?.status === "indexed" && overview.totals?.chunks === Number(job.chunks) && doc0?.strategyId === "pdf_one_per_page",
  `status=${doc0?.status} strategy=${doc0?.strategyId} chunks=${overview.totals?.chunks}`
);

// --- 5. query with citations ---
const queryRes = await fetch(`${base}/api/notebooks/${nbId}/query`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ question: "What does page two cover?", topK: 5 }),
});
const events = await collectSse(queryRes);
const types = events.map((e) => e.type);
const citations = events.filter((e) => e.type === "citation");
const answer = events.filter((e) => e.type === "text-delta").map((e) => e.text).join("");
check(
  "5. query SSE: retrieval → text-delta* → citation* (with page) → usage → done",
  types.includes("retrieval") &&
    types.includes("text-delta") &&
    citations.length > 0 &&
    citations.some((c) => typeof c.page === "number") &&
    types.includes("usage") &&
    types[types.length - 1] === "done",
  `events=${[...new Set(types)].join(",")} citationsWithPage=${citations.filter((c) => c.page).length} answer=${answer.slice(0, 60)}…`
);

// --- 6. empty notebook query → no_documents, no LLM call ---
const empty = await json(
  await fetch(`${base}/api/notebooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Empty", embeddingModelId: "amazon.titan-embed-text-v2:0" }),
  })
);
const emptyEvents = await collectSse(
  await fetch(`${base}/api/notebooks/${empty.id}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "anything", topK: 5 }),
  })
);
check(
  "6. empty notebook → done{no_documents} only",
  emptyEvents.length === 1 && emptyEvents[0].type === "done" && emptyEvents[0].reason === "no_documents",
  JSON.stringify(emptyEvents)
);
await fetch(`${base}/api/notebooks/${empty.id}`, { method: "DELETE" });

// --- 7. model immutability: PATCH model on a notebook WITH documents → ModelLocked ---
const lockRes = await fetch(`${base}/api/notebooks/${nbId}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ embeddingModelId: "cohere.embed-english-v3" }),
});
const lockBody = await json(lockRes);
check(
  "7. change embedding model with documents → ModelLocked (409)",
  lockRes.status === 409 && lockBody.error?.code === "MODEL_LOCKED",
  `status=${lockRes.status} code=${lockBody.error?.code}`
);

// --- 8. delete document → vectors gone ---
const delDoc = await json(
  await fetch(`${base}/api/notebooks/${nbId}/documents/${upload.documentId}`, { method: "DELETE" })
);
const afterDel = await collectSse(
  await fetch(`${base}/api/notebooks/${nbId}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question: "What does page two cover?", topK: 5 }),
  })
);
check(
  "8. delete doc → re-query cannot cite it",
  delDoc.deleted === true &&
    (afterDel[0]?.reason === "no_documents" || afterDel.filter((e) => e.type === "citation").length === 0),
  `firstEvent=${JSON.stringify(afterDel[0])}`
);

// --- 9. delete notebook → no residual dir ---
const delNb = await json(await fetch(`${base}/api/notebooks/${nbId}`, { method: "DELETE" }));
const dataDir = process.env.DATA_DIR ?? "./data";
const residual = path.join(dataDir, "users", "local-user", "notebooks", nbId);
check("9. delete notebook → dir removed from disk", delNb.deleted === true && !existsSync(residual), residual);

console.log(failures === 0 ? "\nSMOKE: ALL PASS" : `\nSMOKE: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
