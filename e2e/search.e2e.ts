import { expect, test, type Page } from "@playwright/test";
import { cited, searched, text, thinking } from "../src/claude/testing";
import { fakeClaude, held, seeded, withKey } from "./fake";

// "Look it up" (docs/design.md, Asking Claude): the switch and its cost, the wait while Claude searches,
// and the sources under an answer that still splits into sentences. Anthropic is faked, with
// replies shaped like the ones recorded on 2026-10-14 and made-up pages.

const RIVERS = { url: "https://example.com/rivers", title: "How rivers cut rock" };
const ODD = { url: "javascript:alert(1)", title: "A page with an odd address" };
const SEARCHED = {
  script: {
    blocks: [thinking(), ...searched("canyon erosion", [RIVERS, ODD]), text("Canyons grow "), cited("about a millimetre a year.", RIVERS), text(" "), cited("Floods move the most rock.", ODD)],
    searches: 1,
  },
};

const sheet = (page: Page) => page.getByRole("complementary", { name: "Thread" });
const lookItUp = (page: Page) => sheet(page).getByRole("button", { name: "Look it up" });
const ask = async (page: Page, question: string) => {
  await sheet(page).getByRole("textbox", { name: "Your question" }).fill(question);
  await sheet(page).getByRole("button", { name: "Ask", exact: true }).click();
};
const tools = (body: unknown) => (body as { tools?: unknown[] }).tools;

test("Look it up searches, shows the wait and the sources, and stays on for the next question", async ({ page }) => {
  await withKey(page);
  const { s1, tC } = await seeded(page);
  const first = held(SEARCHED);
  const sent = await fakeClaude(page, first, SEARCHED);
  await page.goto(`/#/${s1}/t/${tC}`);

  await expect(lookItUp(page)).toHaveAttribute("aria-pressed", "false");
  await expect(sheet(page).getByText(/a search, up to/)).toHaveCount(0);
  await lookItUp(page).tap();
  await expect(lookItUp(page)).toHaveAttribute("aria-pressed", "true");
  await expect(sheet(page).getByText("About 1¢ a search, up to 3, plus the pages Claude reads.")).toBeVisible();

  await ask(page, "How fast?");
  await expect(sheet(page).getByText("Looking it up…")).toBeVisible();
  await page.screenshot({ path: "test-results/search-waiting.png", animations: "disabled" });
  first.release();

  // The answer splits into tappable sentences, with no markers, and its sources sit under it.
  await expect(sheet(page).getByRole("button", { name: "Floods move the most rock." })).toBeVisible();
  await expect(sheet(page).getByText("Looking it up…")).toHaveCount(0);
  const sources = sheet(page).getByRole("region", { name: "Sources" }).last();
  const link = sources.getByRole("link", { name: "How rivers cut rock" });
  await expect(link).toHaveAttribute("href", RIVERS.url);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(sources.getByText("A page with an odd address")).toBeVisible();
  await expect(sources.getByRole("link")).toHaveCount(1); // the javascript: address stays text
  await page.screenshot({ path: "test-results/search-sources.png" });

  expect(tools(sent[0])).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
  await expect(lookItUp(page)).toHaveAttribute("aria-pressed", "true");
  await ask(page, "And floods?");
  await expect(sheet(page).getByRole("region", { name: "Sources" })).toHaveCount(2);
  expect(tools(sent[1])).toHaveLength(1);
});

test("a question asked with Look it up and asked again searches again", async ({ page }) => {
  await withKey(page);
  const { s1, tC } = await seeded(page);
  const sent = await fakeClaude(page, { error: { status: 529, type: "overloaded_error" } }, SEARCHED);
  await page.goto(`/#/${s1}/t/${tC}`);
  await lookItUp(page).tap();
  await ask(page, "How fast?");
  await sheet(page).getByRole("button", { name: "Ask again" }).tap();
  await expect(sheet(page).getByRole("region", { name: "Sources" })).toBeVisible();
  expect(sent.map(tools)).toEqual([expect.any(Array), expect.any(Array)]);
});

test("with Look it up off, no search is sent", async ({ page }) => {
  await withKey(page);
  const { s1, tC } = await seeded(page);
  const sent = await fakeClaude(page, { script: { pieces: ["Grit grinds the rock."] } });
  await page.goto(`/#/${s1}/t/${tC}`);
  await ask(page, "How fast?");
  await expect(sheet(page).getByRole("button", { name: "Grit grinds the rock." })).toBeVisible();
  expect(tools(sent[0])).toBeUndefined();
  await expect(sheet(page).getByRole("region", { name: "Sources" })).toHaveCount(0);
});

test.describe("on a laptop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test("the switch, the wait and the sources sit in the side panel", async ({ page }) => {
    await withKey(page);
    const { s1, tC } = await seeded(page);
    const reply = held(SEARCHED);
    await fakeClaude(page, reply);
    await page.goto(`/#/${s1}/t/${tC}`);
    await lookItUp(page).click();
    await ask(page, "How fast?");
    await expect(sheet(page).getByText("Looking it up…")).toBeVisible();
    await page.screenshot({ path: "test-results/search-laptop-waiting.png", animations: "disabled" });
    reply.release();
    await expect(sheet(page).getByRole("link", { name: "How rivers cut rock" })).toBeVisible();
    await page.screenshot({ path: "test-results/search-laptop-sources.png" });
  });
});
