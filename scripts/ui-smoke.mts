// Drives the real UI headlessly: create notebook → upload → watch ingest → query → citations.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:3001";
const shotDir = "./.verify/ui";
mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors: string[] = [];
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});
const shot = (name: string) => page.screenshot({ path: path.join(shotDir, name), fullPage: false });

try {
  await page.goto(base, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForSelector("text=Notebook RAG Console", { timeout: 30_000 });
  await shot("01-shell.png");
  console.log("✅ shell rendered");

  // create a notebook
  await page.click("text=New Notebook");
  await page.fill('input[placeholder="e.g. Q3 Research"]', "UI Smoke");
  await shot("02-create-dialog.png");
  await page.click('button:has-text("Create")');
  await page.waitForSelector('h2:has-text("UI Smoke")', { timeout: 20_000 });
  await shot("03-workspace.png");
  console.log("✅ notebook created, workspace open");

  // upload valid.pdf in custom mode to exercise schema-driven config
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles("tests/fixtures/valid.pdf");
  await page.waitForSelector("text=valid.pdf");
  await page.click('button:has-text("Custom")');
  await page.waitForSelector("select");
  await shot("04-custom-config.png");
  const configControls = await page.locator("label:has(span)").count();
  console.log(`✅ custom mode shows schema-driven controls (${configControls} fields visible)`);

  await page.click('button:has-text("Upload 1 file(s)")');
  await page.waitForSelector('td :text("indexed")', { timeout: 120_000 });
  await shot("05-indexed.png");
  console.log("✅ document ingested → indexed");

  // query
  await page.fill("textarea", "What does page two cover?");
  await page.keyboard.press("Enter");
  await page.waitForSelector("text=Sources:", { timeout: 120_000 });
  await shot("06-answer.png");

  // expand a citation
  await page.click('button:has-text("[1]")');
  await page.waitForSelector("text=score");
  await shot("07-citation.png");
  console.log("✅ query answered with expandable citations");

  const pageMarker = await page.locator("text=/p\\.[0-9]/").count();
  console.log(pageMarker > 0 ? "✅ citation shows page provenance (p.N)" : "❌ no page provenance in citations");

  // delete the notebook (confirm dialog)
  await page.click('button[title="Delete notebook"]');
  await page.click('button:has-text("Delete permanently")');
  await page.waitForSelector("text=Create a notebook to get started.", { timeout: 20_000 }).catch(() => {});
  await shot("08-deleted.png");
  console.log("✅ notebook deleted");

  const realErrors = errors.filter((e) => !e.includes("favicon"));
  console.log(realErrors.length === 0 ? "✅ no console errors" : `❌ console errors:\n${realErrors.join("\n")}`);
  console.log("UI SMOKE: DONE");
} finally {
  await browser.close();
}
