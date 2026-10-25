import { expect, test, type Page } from "@playwright/test";
import { cited, searched, text } from "../src/claude/testing";
import { fakeClaude, fakeFetch, KEY } from "./fake";

// The built page under the headers Cloudflare sends (docs/design.md, Security), served by `vite
// preview` (playwright.config.ts). Every flow that loads code or talks to a server runs here once:
// the key check, asking with a search, a page and a PDF through /fetch, Settings and the demo. Not one may
// break the CSP. Answers and imported text with HTML in them show as text.

const HOSTILE = `<img src=x onerror="window.evil=1">`;
const SOURCE = { url: "https://example.com/rivers", title: `${HOSTILE} How rivers cut rock` };
const ANSWER = {
  script: { blocks: [...searched("canyon erosion", [SOURCE]), text(`${HOSTILE} is not a tag here. `), cited("Floods move the most rock.", SOURCE)], searches: 1 },
};
const PAGE = `<!doctype html><html><head><title>Rivers</title><script>window.evil = 1</script></head><body><article><h1>How rivers keep time</h1>
${Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i + 1}. A river is the slowest clock most of us will ever look at. <img src=x onerror="window.evil=1"> The canyon it cuts records changes that took thousands of years. Standing on a bridge, you see one frame of a long film, and the rest of it is written in the terraces, the gravel and the bends.</p>`).join("\n")}
</article></body></html>`;

const card = (page: Page) => page.getByRole("region", { name: "Add something to read" });
const sheet = (page: Page) => page.getByRole("complementary", { name: "Thread" });
const linkIn = async (page: Page, url: string) => {
  await card(page).getByRole("tab", { name: "Link" }).tap();
  await card(page).getByRole("textbox", { name: "Link" }).fill(url);
  await card(page).getByRole("button", { name: "Get the page" }).tap();
  await expect(card(page).getByText(/about [\d,]+ tokens$/)).toBeVisible();
  await card(page).getByRole("button", { name: "Start reading" }).tap();
  await expect(page.getByRole("article", { name: "The article" }).locator("p").first()).toBeVisible();
};

/** What the CSP blocked, as the page saw it. */
const violations = (page: Page) => page.evaluate(() => (window as { blocked?: string[] }).blocked ?? []);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const blocked: string[] = ((window as { blocked?: string[] }).blocked = []);
    document.addEventListener("securitypolicyviolation", (e) => blocked.push(`${e.effectiveDirective} ${e.blockedURI}`));
  });
});

test("the page is served with the CSP and its other headers", async ({ page }) => {
  const response = (await page.goto("/"))!;
  const headers = response.headers();
  expect(headers["content-security-policy"]).toContain("script-src 'self'");
  expect(headers["content-security-policy"]).toContain("connect-src 'self' https://api.anthropic.com");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["referrer-policy"]).toBe("no-referrer");
  await expect(card(page)).toBeVisible();
  expect(await violations(page)).toEqual([]);
});

test("a key is checked, a page comes in through /fetch, and an answer with a search streams in, all as text", async ({ page }) => {
  const sent = await fakeClaude(page, ANSWER);
  await fakeFetch(page, { "https://news.example/rivers": { html: PAGE } });
  await page.goto("/");
  await page.getByLabel("API key").fill(KEY);
  await page.getByRole("button", { name: "Check and save" }).tap();
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();

  await linkIn(page, "https://news.example/rivers");
  await page.locator('[data-sentence="article|p0:s0"]').tap();
  await sheet(page).getByRole("button", { name: "Look it up" }).tap();
  await sheet(page).getByRole("textbox", { name: "Your question" }).fill("How fast?");
  await sheet(page).getByRole("button", { name: "Ask", exact: true }).tap();

  await expect(sheet(page).getByRole("button", { name: "Floods move the most rock." })).toBeVisible();
  await expect(sheet(page).getByText(`${HOSTILE} is not a tag here.`)).toBeVisible();
  await expect(sheet(page).getByRole("link", { name: SOURCE.title })).toHaveAttribute("href", SOURCE.url);
  await expect(sheet(page).locator("img")).toHaveCount(0);
  await expect(page.getByRole("article", { name: "The article" }).locator("img")).toHaveCount(0);
  expect(sent).toHaveLength(1);
  expect(await page.evaluate(() => (window as { evil?: number }).evil)).toBeUndefined();
  expect(await violations(page)).toEqual([]);
});

test("a PDF is read in its worker", async ({ page }) => {
  await fakeFetch(page, { "https://papers.example/essay.pdf": { pdf: "src/import/fixtures/pdf/chrome-essay.pdf", url: "https://papers.example/essay.pdf" } });
  await page.goto("/");
  await linkIn(page, "https://papers.example/essay.pdf");
  await expect(page.getByRole("article", { name: "The article" }).locator("p")).toHaveCount(11);
  expect(await violations(page)).toEqual([]);
});

test("Settings opens, its theme applies, and its backup downloads", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  // The build turns light-dark() into variables (Lightning CSS), so the theme is checked here too.
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await expect.poll(background).toBe("rgb(28, 31, 36)");
  await page.getByRole("radio", { name: "Light" }).check();
  await expect.poll(background).toBe("rgb(242, 242, 247)");
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export everything" }).tap();
  await saving;
  expect(await violations(page)).toEqual([]);
});

test("the demo opens and branches with no key", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Open the demo" }).tap();
  await page.getByRole("button", { name: /^Conversation on "The distinctive characteristic/ }).tap();
  await sheet(page).getByRole("button", { name: "A hole meant lift, no hole meant stay down.", exact: true }).tap();
  await expect(sheet(page)).toContainText("Where did punched cards go after the loom?");
  expect(await violations(page)).toEqual([]);
});
