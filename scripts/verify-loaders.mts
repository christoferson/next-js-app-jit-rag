// Verifies: pdfjs-dist per-page text extraction (needed for pdf_one_per_page provenance)
// and chardet + iconv-lite encoding fallback on a non-UTF8 (latin1) file.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

mkdirSync("./.verify", { recursive: true });

// ---- build a minimal 2-page PDF by hand ----
function minimalPdf(pages: string[]): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objs.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);
  objs.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  pages.forEach((text, i) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
    objs.push(
      `${4 + i * 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>\nendobj\n`
    );
    objs.push(`${5 + i * 2} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`);
  });
  let body = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objs) { offsets.push(body.length); body += o; }
  const xrefPos = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) body += `${String(off).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(body, "latin1");
}

writeFileSync("./.verify/two-page.pdf", minimalPdf(["Hello page one", "Hello page two"]));

// ---- pdfjs-dist per-page extraction ----
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const data = new Uint8Array(readFileSync("./.verify/two-page.pdf"));
const task = pdfjs.getDocument({ data, useWorkerFetch: false, standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" });
const doc = await task.promise;
console.log("pdfjs numPages =", doc.numPages);
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const content = await page.getTextContent();
  const text = content.items.map((it: any) => ("str" in it ? it.str : "")).join(" ");
  console.log(`  page ${p}: ${JSON.stringify(text)}`);
}
await task.destroy();

// ---- corrupt PDF must throw a catchable error, not crash ----
writeFileSync("./.verify/corrupt.pdf", Buffer.from("%PDF-1.4 garbage garbage"));
try {
  await pdfjs.getDocument({ data: new Uint8Array(readFileSync("./.verify/corrupt.pdf")), useWorkerFetch: false }).promise;
  console.log("corrupt.pdf unexpectedly parsed");
} catch (e: any) {
  console.log("corrupt.pdf → catchable error:", e.name, "-", String(e.message).slice(0, 60));
}

// ---- chardet + iconv-lite latin1 fallback ----
const chardet = (await import("chardet")).default;
const iconv = (await import("iconv-lite")).default;
const latin1 = Buffer.from("caf\xe9 na\xefve r\xe9sum\xe9", "latin1");
writeFileSync("./.verify/latin1.txt", latin1);
const detected = chardet.detect(readFileSync("./.verify/latin1.txt"));
const decoded = iconv.decode(readFileSync("./.verify/latin1.txt"), detected ?? "utf-8");
console.log("chardet detected:", detected, "→ decoded:", JSON.stringify(decoded));

console.log("LOADERS VERIFY: DONE");
