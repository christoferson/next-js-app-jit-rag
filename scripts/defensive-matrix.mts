// §7 defensive matrix at the API level: each bad fixture fails ITS OWN document
// with a readable reason; siblings index fine; server never crashes.
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:3001";
let failures = 0;
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

const nb = await (
  await fetch(`${base}/api/notebooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Defensive", embeddingModelId: "amazon.titan-embed-text-v2:0" }),
  })
).json();

async function upload(fixture: string, mime: string) {
  const form = new FormData();
  form.append("file", new File([readFileSync(`tests/fixtures/${fixture}`)], fixture, { type: mime }));
  form.append("chunkingMode", "auto");
  const res = await fetch(`${base}/api/notebooks/${nb.id}/documents`, { method: "POST", body: form });
  return { status: res.status, body: await res.json() };
}

async function waitJob(jobId: string) {
  for (;;) {
    const job = await (await fetch(`${base}/api/jobs/${jobId}`)).json();
    if (job.status === "done" || job.status === "error") return job;
    await new Promise((r) => setTimeout(r, 500));
  }
}

// batch: valid + corrupt + empty + image-only + mislabeled + latin1 + whitespace, all at once
const uploads = await Promise.all([
  upload("valid.pdf", "application/pdf"),
  upload("corrupt.pdf", "application/pdf"),
  upload("empty.txt", "text/plain"),
  upload("image-only.pdf", "application/pdf"),
  upload("mislabeled.txt", "text/plain"),
  upload("latin1.txt", "text/plain"),
  upload("whitespace.txt", "text/plain"),
]);
for (const u of uploads) check("202 accepted", u.status === 202, JSON.stringify(u.body).slice(0, 80));

const jobs = await Promise.all(uploads.map((u) => waitJob(u.body.jobId)));
const [valid, corrupt, empty, imageOnly, mislabeled, latin1, whitespace] = jobs;

check("valid.pdf → done, chunks>0", valid.status === "done" && valid.chunks > 0, `chunks=${valid.chunks}`);
check("corrupt.pdf → doc-error, readable", corrupt.status === "error" && !!corrupt.error, corrupt.error);
check("empty.txt → doc-error('empty document')", empty.status === "error" && /empty/i.test(empty.error ?? ""), empty.error);
check("image-only.pdf → doc-error('no extractable text')", imageOnly.status === "error" && /no extractable/i.test(imageOnly.error ?? ""), imageOnly.error);
check("mislabeled.txt (binary) → doc-error", mislabeled.status === "error", mislabeled.error);
check("latin1.txt → decoded OR clean error (indexed acceptable)", latin1.status === "done" || latin1.status === "error", `status=${latin1.status} chunks=${latin1.chunks ?? ""} err=${latin1.error ?? ""}`);
check("whitespace.txt → doc-error('empty document')", whitespace.status === "error" && /empty/i.test(whitespace.error ?? ""), whitespace.error);

// oversize: rejected at route level BEFORE parse (fake 51MB body)
const bigForm = new FormData();
bigForm.append("file", new File([new Uint8Array(51 * 1024 * 1024)], "oversize.txt", { type: "text/plain" }));
bigForm.append("chunkingMode", "auto");
const bigRes = await fetch(`${base}/api/notebooks/${nb.id}/documents`, { method: "POST", body: bigForm });
const bigBody = await bigRes.json().catch(() => ({}));
check("oversize.txt → 413 with cap message", bigRes.status === 413 && /50MB/.test(bigBody.error?.message ?? ""), `${bigRes.status} ${bigBody.error?.message}`);

// server still alive and notebook consistent
const detail = await (await fetch(`${base}/api/notebooks/${nb.id}`)).json();
const indexed = detail.documents.filter((d: { status: string }) => d.status === "indexed").length;
const errored = detail.documents.filter((d: { status: string }) => d.status === "error").length;
check("server alive; batch isolated per-document", indexed >= 1 && errored >= 5, `indexed=${indexed} errored=${errored}`);

await fetch(`${base}/api/notebooks/${nb.id}`, { method: "DELETE" });
console.log(failures === 0 ? "\nDEFENSIVE MATRIX: ALL PASS" : `\nDEFENSIVE MATRIX: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
