// Makes the PDF fixtures in src/import/fixtures/pdf (docs/design.md, Import) from made-up text,
// with the tools real PDFs come from: Chrome (what Google Docs and most browsers print with),
// macOS's Quartz (Pages, TextEdit, Print to PDF) and PDFKit. Run on a Mac:
//   fnm exec --using=24 -- node scripts/pdf-fixtures/make.mjs
// The two arXiv papers are downloaded, not made: see the fixtures' README.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";

const HERE = new URL(".", import.meta.url).pathname;
const OUT = new URL("../../src/import/fixtures/pdf/", import.meta.url).pathname;
const TMP = mkdtempSync(join(tmpdir(), "pdf-fixtures-"));
const [title, ...paragraphs] = readFileSync(join(HERE, "essay.txt"), "utf8").trim().split(/\n\s*\n/);

const html = (columns) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
  body { font: 13pt/1.45 Georgia, serif; margin: 0; }
  h1 { font-size: 20pt; column-span: all; }
  main { columns: ${columns}; column-gap: 28pt; text-align: justify; hyphens: auto; }
  p { margin: 0 0 10pt; }
</style></head><body><h1>${title}</h1><main>${paragraphs.map((p) => `<p>${p}</p>`).join("")}</main></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
const print = async (file, body, extra = {}) => {
  await page.setContent(body);
  await page.pdf({ path: join(OUT, file), width: "5.5in", height: "7in", margin: { top: "0.8in", bottom: "0.8in", left: "0.6in", right: "0.6in" }, ...extra });
};

// One column, narrow, hyphenated, with a running header and a numbered footer on every page.
await print("chrome-essay.pdf", html(1), {
  displayHeaderFooter: true,
  headerTemplate: `<div style="font-size:8pt;width:100%;text-align:center;color:#666">The Made-up Quarterly</div>`,
  footerTemplate: `<div style="font-size:8pt;width:100%;text-align:center;color:#666">Rivers and time · <span class="pageNumber"></span></div>`,
});

// The same essay in two columns on a wider page.
await page.setContent(html(2));
await page.pdf({ path: join(OUT, "chrome-columns.pdf"), width: "8.5in", height: "6in", margin: { top: "0.6in", bottom: "0.6in", left: "0.6in", right: "0.6in" } });

// A "scan": the first paragraph as a picture, with no text layer.
await page.setViewportSize({ width: 700, height: 500 });
await page.setContent(`<body style="font:20px Georgia;padding:24px;background:#fff">${paragraphs[0]}</body>`);
const picture = (await page.screenshot()).toString("base64");
await print("scanned.pdf", `<body style="margin:0"><img src="data:image/png;base64,${picture}" style="width:100%"><img src="data:image/png;base64,${picture}" style="width:100%"></body>`);
await browser.close();

// The essay as TextEdit or Pages prints it: AppKit and Quartz, wrapped at words, no running lines.
const notes = join(TMP, "notes.txt");
writeFileSync(notes, `${title}\n\n${paragraphs.join("\n\n")}\n`);
execFileSync("swift", [join(HERE, "quartz.swift"), notes, join(OUT, "quartz-notes.pdf")], { stdio: ["ignore", "ignore", "inherit"] });

// The notes again, locked with a password, by PDFKit.
execFileSync("swift", [join(HERE, "lock.swift"), join(OUT, "quartz-notes.pdf"), join(OUT, "locked.pdf")], { stdio: "inherit" });

console.log("Made the PDF fixtures in", OUT);
