// Generates deterministic PDF fixtures: valid.pdf (3 pages with text), image-only.pdf (no text layer).
import { writeFileSync } from "node:fs";

function pdf(pages: { text?: string }[]): Buffer {
  const objs: string[] = [];
  const kids = pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ");
  objs.push(`1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`);
  objs.push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>\nendobj\n`);
  objs.push(`3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`);
  pages.forEach((p, i) => {
    const stream = p.text ? `BT /F1 12 Tf 72 720 Td (${p.text}) Tj ET` : ``;
    objs.push(`${4 + i * 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>\nendobj\n`);
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

writeFileSync("tests/fixtures/valid.pdf", pdf([
  { text: "Page one discusses the migration plan for the data pipeline." },
  { text: "Page two covers rollback procedures and safety checks." },
  { text: "Page three lists the stakeholders and the timeline." },
]));
writeFileSync("tests/fixtures/image-only.pdf", pdf([{}, {}]));
console.log("fixtures written");
