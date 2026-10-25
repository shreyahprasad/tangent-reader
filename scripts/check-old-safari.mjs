// Checks PDF import on the built page in an older Safari engine (docs/design.md, Import): the
// modern pdf.js build and its getTextContent failed on an iPhone, and the e2e suite runs Chromium.
// Playwright ships one WebKit per release, so an older WebKit comes from an older playwright-core:
//   mkdir -p ~/pw-1.45 && cd ~/pw-1.45 && npm i --ignore-scripts playwright-core@1.45.3 && npx playwright-core install webkit
//   (1.45.3 is WebKit 17.4, 1.52.0 is 18.4; the repo's own is 26.6)
// Then, from the repo, with a fresh build:
//   fnm exec --using=24 -- pnpm build && fnm exec --using=24 -- pnpm exec vite preview --port 5191 &
//   fnm exec --using=24 -- node scripts/check-old-safari.mjs ~/pw-1.45/node_modules/playwright-core http://127.0.0.1:5191
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const [playwrightCore, base] = process.argv.slice(2);
if (!playwrightCore || !base) {
  console.error("usage: node scripts/check-old-safari.mjs <path to playwright-core> <base URL>");
  process.exit(2);
}
const { webkit, devices } = createRequire(import.meta.url)(playwrightCore);
const FIXTURES = new URL("../src/import/fixtures/pdf/", import.meta.url);

const browser = await webkit.launch();
const page = await (await browser.newContext({ ...devices["iPhone 13"] })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${base}/`);
await page.getByRole("tab", { name: "File" }).click();

const pick = (name) =>
  page.locator('input[type="file"]').evaluate(
    (input, [name, bytes]) => {
      const picked = new DataTransfer();
      picked.items.add(new File([new Uint8Array(bytes)], name, { type: "application/pdf" }));
      input.files = picked.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [name, [...readFileSync(new URL(name, FIXTURES))]],
  );
const outcome = () => page.locator('[role="tabpanel"] p').last().textContent();

let failed = false;
const expect = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  failed ||= !ok;
};

for (const [name, want] of [
  ["chrome-essay.pdf", /^chrome-essay\.pdf, 4 pages, about/],
  ["arxiv-2401.00023.pdf", /^arxiv-2401\.00023\.pdf, 12 pages, about/],
  ["scanned.pdf", /^This PDF is pictures of pages/],
]) {
  await pick(name);
  // A locator, not waitForFunction: that evaluates code in the page, which the CSP blocks in WebKit.
  await page.locator('[role="tabpanel"] p').filter({ hasText: want }).waitFor({ timeout: 30_000 }).catch(() => {});
  const got = (await outcome()).trim();
  expect(want.test(got), `${name}: ${got}`);
}
await pick("chrome-essay.pdf");
await page.getByText(/pages, about/).waitFor();
await page.getByRole("button", { name: "Start reading" }).click();
const article = page.getByRole("article", { name: "The article" });
await article.locator("p").first().waitFor();
const paragraphs = await article.locator("p").count();
expect(paragraphs === 11, `started reading: ${paragraphs} paragraphs`);
expect(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
console.log(`WebKit ${browser.version()}`);
await browser.close();
process.exit(failed ? 1 : 0);
