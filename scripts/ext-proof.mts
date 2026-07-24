// §6 extensibility proof driver: ingest with no_op_paragraphs, assert config
// clamped/stripped by schema-compiled zod, chunks carry its provenance.
const base = process.argv[2] ?? "http://localhost:3001";

const nb = await (
  await fetch(`${base}/api/notebooks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "ExtProof", embeddingModelId: "amazon.titan-embed-text-v2:0" }),
  })
).json();

const form = new FormData();
const txt = await import("node:fs").then((fs) => fs.readFileSync("tests/fixtures/valid.txt"));
form.append("file", new File([txt], "valid.txt", { type: "text/plain" }));
form.append("chunkingMode", "custom");
form.append("strategyId", "no_op_paragraphs");
form.append("strategyConfig", JSON.stringify({ minLength: -5, evil: "x" })); // below min + unknown field

const up = await (await fetch(`${base}/api/notebooks/${nb.id}/documents`, { method: "POST", body: form })).json();
console.log("upload:", JSON.stringify(up));

for (;;) {
  const job = await (await fetch(`${base}/api/jobs/${up.jobId}`)).json();
  if (job.status === "done" || job.status === "error") {
    console.log("job:", JSON.stringify(job));
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}

const detail = await (await fetch(`${base}/api/notebooks/${nb.id}`)).json();
const doc = detail.documents[0];
console.log("document strategyId:", doc.strategyId);
console.log("stored config (clamped/stripped):", JSON.stringify(doc.strategyConfig));
console.log("status:", doc.status, "| chunks:", doc.chunkCount);

const ok =
  doc.strategyId === "no_op_paragraphs" &&
  doc.strategyConfig.minLength === 1 && // clamped from -5 up to the schema min
  !("evil" in doc.strategyConfig) &&
  doc.status === "indexed" &&
  doc.chunkCount > 0;
console.log(ok ? "EXT PROOF: PASS" : "EXT PROOF: FAIL");

await fetch(`${base}/api/notebooks/${nb.id}`, { method: "DELETE" });
process.exit(ok ? 0 : 1);
