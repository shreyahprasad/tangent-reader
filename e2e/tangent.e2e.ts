import { expect, test, type Page } from "@playwright/test";
import { seeded, visitsOf } from "./fake";

// Finding your way around on a phone, and coming back (docs/design.md, Reading and navigation, and Screens).

const dot = (page: Page, sentence: string) => page.getByRole("button", { name: new RegExp(`^Conversation on "${sentence}`) });
const sheet = (page: Page) => page.getByRole("complementary", { name: "Thread" });
const scrolled = (page: Page) => page.locator("main").evaluate((m) => m.scrollTop);
/** Leaving the session saves the visits still waiting. */
const leave = (page: Page) => page.getByRole("link", { name: "Library", exact: true }).first().tap();
const vias = (page: Page, sessionId: string) => async () => (await visitsOf(page, sessionId)).map((v) => v.via);

test("a tangent reads against the answer it came from, and closes one level up", async ({ page }) => {
  const { s1, tA, tB, mA2 } = await seeded(page);
  await page.goto(`/#/${s1}/t/${tA}`);
  await sheet(page).getByRole("button", { name: "It also means another.", exact: true }).tap(); // a sentence in the answer
  await expect(page).toHaveURL(new RegExp(`/t/${tB}/full$`)); // a tangent you have been down opens full
  await page.getByRole("button", { name: "Show the article above" }).tap();
  await expect(page).toHaveURL(new RegExp(`/t/${tB}$`));

  // The base is now that answer, its sentence lit, and the sheet is the tangent's own conversation.
  const base = page.getByRole("article", { name: "The answer this tangent came from" });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("What is the claim?");
  await expect(base).toContainText("It means one thing. It also means another.");
  await expect(base).not.toContainText("Paragraph 0 opens");
  await expect(page.locator(`[data-sentence="${mA2}|p0:s1"]`)).toHaveClass(/anchor-lit/);
  await expect(sheet(page).locator("blockquote")).toHaveText("It also means another.");
  await expect(sheet(page)).toContainText("Another how?");

  // Another sentence of the base answer branches beside it, read against the same answer.
  await page.locator(`[data-sentence="${mA2}|p0:s0"]`).tap();
  await expect(sheet(page).locator("blockquote")).toHaveText("It means one thing.");
  await expect(page.locator(`[data-sentence="${mA2}|p0:s0"]`)).toHaveClass(/anchor-lit/);
  await expect(base).toBeVisible();

  // Let it go again: back up to the answer's thread, not out to the article.
  await page.locator(`[data-sentence="${mA2}|p0:s0"]`).tap();
  await expect(page).toHaveURL(new RegExp(`/t/${tA}$`));
  await expect(page.getByRole("article", { name: "The article" })).toBeVisible();

  // Closing a tangent goes to its parent; closing an anchor goes to the article.
  await page.goto(`/#/${s1}/t/${tB}`);
  await page.getByRole("button", { name: "Close the thread" }).tap();
  await expect(page).toHaveURL(new RegExp(`/t/${tA}$`));
  await expect(sheet(page).locator("blockquote")).toHaveText("Paragraph 0 opens with a plain claim about the subject at hand.");
  await page.getByRole("button", { name: "Close the thread" }).tap();
  await expect(page).toHaveURL(new RegExp(`#/${s1}$`));
  await expect(sheet(page)).toBeHidden();
});

test("dragging the sheet replaces the address, so Back skips its heights", async ({ page }) => {
  const { s1, tA } = await seeded(page);
  await page.goto(`/#/${s1}`);
  await dot(page, "Paragraph 0 opens").tap();
  await expect(page).toHaveURL(new RegExp(`#/${s1}/t/${tA}/full$`));
  await page.getByRole("button", { name: "Show the article above" }).tap();
  await expect(page).toHaveURL(new RegExp(`#/${s1}/t/${tA}$`));
  await expect(page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "A test article" })).toHaveAttribute("href", `#/${s1}`);
  await page.getByRole("button", { name: "Show the whole thread" }).tap();
  await expect(page).toHaveURL(new RegExp(`#/${s1}/t/${tA}/full$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`#/${s1}$`));
});

test("Back puts the article where you left it, and each move is logged with how you moved", async ({ page }) => {
  const { s1, tC } = await seeded(page);
  await page.goto(`/#/${s1}`);
  const far = dot(page, "It goes on to give a reason");
  await far.scrollIntoViewIfNeeded();
  const before = await scrolled(page);
  expect(before).toBeGreaterThan(0);

  await far.tap();
  await expect(page).toHaveURL(new RegExp(`/t/${tC}/full$`)); // a thread you have been down opens full
  await page.getByRole("button", { name: "Back", exact: true }).tap();
  await expect(page).toHaveURL(new RegExp(`#/${s1}$`));
  await expect.poll(() => scrolled(page)).toBeCloseTo(before, -1);

  await leave(page);
  await expect.poll(vias(page, s1)).toEqual(["open", "dot", "back"]);
  expect((await visitsOf(page, s1))[1]).toMatchObject({ view: "thread", thread_id: tC, anchor_key: "p8:s1", sheet: "full" });
});

test("one Back from the start returns you to the thread you were deep in", async ({ page }) => {
  const { s1, tB } = await seeded(page);
  await page.goto(`/#/${s1}/t/${tB}`);
  await page.getByRole("button", { name: /^Back to start/ }).tap();
  await expect(page).toHaveURL(new RegExp(`#/${s1}/at/p0%3As0$`));
  await expect(sheet(page)).toBeHidden();
  await expect(page.locator('[data-sentence="article|p0:s0"]')).toHaveClass(/anchor-lit/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/t/${tB}$`));

  await leave(page);
  await expect.poll(vias(page, s1)).toEqual(["open", "start", "back"]);
  expect((await visitsOf(page, s1))[1]).toMatchObject({ view: "article", anchor_key: "p0:s0" });
});

test("Map shows the session as a tree, and a line goes there", async ({ page }) => {
  const { s1, tB, tC } = await seeded(page);
  await page.goto(`/#/${s1}/t/${tB}`);
  await page.getByRole("button", { name: "Map of this session" }).first().tap();
  const here = page.locator('button[aria-current="location"]');
  await expect(here).toContainText("Another how?");
  await expect(here).toContainText("Here");

  await page.getByRole("button", { name: /Why does it take a while/ }).tap();
  await expect(page).toHaveURL(new RegExp(`/t/${tC}$`));
  await page.getByRole("button", { name: "Back", exact: true }).tap();
  await expect(page).toHaveURL(new RegExp(`/t/${tB}$`));

  await leave(page);
  await expect.poll(vias(page, s1)).toEqual(["open", "map", "back"]);
});

test("the map opens from the article too, with nothing marked here, and a line goes there", async ({ page }) => {
  const { s1, tC } = await seeded(page);
  await page.goto(`/#/${s1}`);
  await page.getByRole("button", { name: "Map of this session" }).tap();
  const map = page.getByRole("complementary", { name: "Map" });
  await expect(map.getByRole("button", { name: /Why does it take a while/ })).toBeVisible();
  await expect(map.locator('[aria-current="location"]')).toHaveCount(0);

  await map.getByRole("button", { name: /Why does it take a while/ }).tap();
  await expect(page).toHaveURL(new RegExp(`/t/${tC}$`));
  await expect(map).toBeHidden();
  await leave(page);
  await expect.poll(vias(page, s1)).toEqual(["open", "map"]);
});

test("the article's map closes with Close, Esc or its Article line", async ({ page }) => {
  const { s1 } = await seeded(page);
  await page.goto(`/#/${s1}`);
  const open = page.getByRole("button", { name: "Map of this session" });
  const map = page.getByRole("complementary", { name: "Map" });
  for (const close of [() => map.getByRole("button", { name: "Close" }).tap(), () => page.keyboard.press("Escape"), () => map.getByRole("button", { name: "Article" }).tap()]) {
    await open.tap();
    await expect(map).toBeVisible();
    await close();
    await expect(map).toBeHidden();
    await expect(open).toBeFocused();
  }
});

test("a session with no threads has no map to open", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Paste" }).tap();
  await page.getByRole("textbox", { name: "Article" }).fill("Rivers carve canyons over millions of years.\n\nThe Colorado River cut the Grand Canyon.");
  await page.getByRole("button", { name: "Start reading" }).tap();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Map of this session" })).toHaveCount(0);
});

test("Flag marks a thread to come back to, and the map shows it", async ({ page }) => {
  const { s1, tB } = await seeded(page);
  await page.goto(`/#/${s1}/t/${tB}`);
  const flag = page.getByRole("button", { name: "Flag this thread" });
  await expect(flag).toHaveAttribute("aria-pressed", "false");
  await flag.tap();
  await expect(flag).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Map of this session" }).first().tap();
  await expect(page.locator('button[aria-current="location"]').getByRole("img", { name: "Flagged" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: "Flag this thread" })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Flag this thread" }).tap();
  await expect(page.getByRole("button", { name: "Flag this thread" })).toHaveAttribute("aria-pressed", "false");
});

test("Pick up lands where you left off, at the sheet's height, logged as resume", async ({ page }) => {
  const { s1, tB } = await seeded(page, { lastVisit: { view: "thread", thread: "tB", anchor_key: "p0:s0", sheet: "full" } });
  await page.goto("/#/");
  const card = page.getByRole("region", { name: "Pick up" });
  await card.getByRole("link", { name: /^Where you left off: A test article, at Article, then What is the claim\?, then Another how\?$/ }).tap();
  await expect(page).toHaveURL(new RegExp(`#/${s1}/t/${tB}/full$`));
  await expect(sheet(page)).toBeVisible();

  await page.goBack(); // the full sheet covers the breadcrumb; Back to the library saves the visit
  await expect(page.getByRole("region", { name: "Pick up" })).toBeVisible();
  await expect.poll(vias(page, s1)).toEqual(["open", "resume"]); // the seeded visit, then this one
  expect((await visitsOf(page, s1))[1]).toMatchObject({ view: "thread", thread_id: tB, sheet: "full" });
});

test("Pick up shows the place you just left, once its visit is saved", async ({ page }) => {
  const { s1, tC } = await seeded(page, { lastVisit: { view: "thread", thread: "tA", anchor_key: "p0:s0", sheet: "half" } });
  await page.goto(`/#/${s1}/t/${tC}`);
  await expect(sheet(page)).toBeVisible();
  await leave(page);
  await expect(page.getByRole("link", { name: /^Where you left off/ })).toHaveAccessibleName(/Why does it take a while\?$/);
});

test("Pick up shows three open loops, the rest under All, and not the thread it resumes", async ({ page }) => {
  const { s1, loops } = await seeded(page, {
    flagA: true,
    lastVisit: { view: "thread", thread: "tA", anchor_key: "p0:s0", sheet: "half" },
    loops: ["Five?", "Four?", "Three?", null, "One?"], // made oldest first, so shown newest first
  });
  await page.goto("/#/");
  const card = page.getByRole("region", { name: "Pick up" });
  const lines = card.getByRole("link").filter({ hasNotText: /^A test article/ });
  await expect(lines).toHaveText([/^One\?/, /^It closes on a third and final point\./, /^Three\?/]);
  await card.getByRole("button", { name: "All 5" }).tap();
  await expect(lines).toHaveCount(5);
  await expect(card.getByRole("button", { name: /^All/ })).toBeHidden();

  await lines.nth(1).tap();
  await expect(page).toHaveURL(new RegExp(`#/${s1}/t/${loops[3]}$`));
});

test("Pick up is not there when there is nothing to pick up", async ({ page }) => {
  await seeded(page);
  await page.goto("/#/");
  await expect(page.getByRole("region", { name: "Sessions" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Pick up" })).toBeHidden();
});

test.describe("on a laptop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test("the article's map sits beside the article", async ({ page }) => {
    const { s1 } = await seeded(page);
    await page.goto(`/#/${s1}`);
    await page.getByRole("button", { name: "Map of this session" }).click();
    const map = await page.getByRole("complementary", { name: "Map" }).boundingBox();
    const article = await page.getByRole("article", { name: "The article" }).boundingBox();
    expect(map!.x).toBeGreaterThan(article!.x + article!.width - 1);
  });

  test("Esc closes the thread and hands focus back to its sentence", async ({ page }) => {
    const { s1, tC } = await seeded(page);
    await page.goto(`/#/${s1}/t/${tC}`);
    await page.getByRole("button", { name: "Flag this thread" }).focus();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`#/${s1}$`));
    await expect(page.locator('[data-sentence="article|p8:s1"]')).toBeFocused();
  });

  test("Esc in a tangent goes up to its parent, with focus on the sentence it branched from", async ({ page }) => {
    const { s1, tA, tB, mA2 } = await seeded(page);
    await page.goto(`/#/${s1}/t/${tB}`);
    await page.getByRole("button", { name: "Flag this thread" }).focus();
    await page.keyboard.press("Escape");
    await expect(page).toHaveURL(new RegExp(`/t/${tA}$`));
    await expect(page.locator(`[data-sentence="${mA2}|p0:s1"]`)).toBeFocused();
  });

  test("Full widens the thread as a new history entry, so Back narrows it", async ({ page }) => {
    const { s1, tA } = await seeded(page);
    await page.goto(`/#/${s1}`);
    await dot(page, "Paragraph 0 opens").click();
    const narrow = (await sheet(page).boundingBox())!.width;
    await page.getByRole("button", { name: "Widen the thread" }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${tA}/full$`));
    await expect.poll(async () => (await sheet(page).boundingBox())!.width).toBeGreaterThan(narrow);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/t/${tA}$`));
    await expect.poll(async () => (await sheet(page).boundingBox())!.width).toBe(narrow);
  });
});
