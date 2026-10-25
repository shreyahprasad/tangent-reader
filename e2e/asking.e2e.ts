import { expect, test, type Page } from "@playwright/test";
import { fakeClaude, held, KEY, never, seeded, withKey } from "./fake";

// Asking Claude from this browser, with Anthropic faked (docs/design.md, Asking Claude and Screens): the
// paste flow end to end, a reply arriving, Ask again, a reply cut short by a reload, and no key.

const ANSWER = { pieces: ["Grit grinds the rock. ", "Floods do most of the work."] };
const sheet = (page: Page) => page.getByRole("complementary", { name: "Thread" });
const ask = async (page: Page, question: string) => {
  await sheet(page).getByRole("textbox", { name: "Your question" }).fill(question);
  await sheet(page).getByRole("button", { name: "Ask", exact: true }).click();
};

test("paste, tap a sentence, ask, and branch from the answer", async ({ page }) => {
  await withKey(page);
  const reply = held({ script: ANSWER });
  const sent = await fakeClaude(page, reply);
  await page.goto("/");
  await page.getByRole("tab", { name: "Paste" }).tap();
  await page.getByRole("textbox", { name: "Article" }).fill("Rivers carve canyons over millions of years.\n\nThe Colorado River cut the Grand Canyon.");
  await page.getByRole("button", { name: "Start reading" }).tap();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Rivers carve canyons over millions of years.");
  await expect(page.getByText(/^From /)).toHaveCount(0); // a paste has no source line

  await page.locator('[data-sentence="article|p0:s0"]').tap();
  await expect(sheet(page).getByRole("button", { name: "Look it up" })).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Why does this matter?" })).toHaveCount(0); // suggestions are hidden (style.ts)
  await ask(page, "Why so slow?");
  await expect(sheet(page).getByText("Claude is thinking")).toBeAttached();
  await expect(sheet(page).getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
  reply.release();

  const branch = sheet(page).getByRole("button", { name: "Floods do most of the work." });
  await expect(branch).toBeVisible();
  await expect(sheet(page).getByText("Claude is thinking")).not.toBeAttached();
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent[0])).toContain("The Colorado River cut the Grand Canyon.");
  expect(JSON.stringify(sent[0])).not.toContain(KEY);

  await expect(page.getByText(/tokens · \$0\.0\d/)).toBeAttached(); // the session's cost, from the call log

  await branch.tap();
  await expect(sheet(page).locator("blockquote")).toHaveText("Floods do most of the work.");
  await expect(page.getByRole("article", { name: "The answer this tangent came from" })).toContainText("Grit grinds the rock.");
  await expect(page.getByRole("button", { name: "Back to start: the article sentence this began on" })).toBeVisible();
});

test("tapping an empty anchor again lets it go: no dot, no light, no sheet", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Paste" }).tap();
  await page.getByRole("textbox", { name: "Article" }).fill("Rivers carve canyons. Slowly, over ages.");
  await page.getByRole("button", { name: "Start reading" }).tap();
  const sentence = page.locator('[data-sentence="article|p0:s0"]');
  await sentence.tap();
  await expect(sheet(page)).toBeVisible();
  await expect(sentence).toHaveAttribute("aria-pressed", "true");

  await sentence.tap();
  await expect(sheet(page)).toBeHidden();
  await expect(sentence).toHaveAttribute("aria-pressed", "false");
  await expect(sentence).not.toHaveClass(/anchor-lit|anchor-tint/);
  await expect(page).toHaveURL(/#\/[0-9a-f-]+$/); // the plain article, not at the sentence
});

test("asking from a half sheet on the phone opens it full, to read the answer", async ({ page }) => {
  await withKey(page);
  const { s1, tC } = await seeded(page);
  await fakeClaude(page, { script: ANSWER });
  await page.goto(`/#/${s1}`);
  await page.getByRole("button", { name: /^Conversation on "It goes on to give a reason/ }).tap();
  await page.getByRole("button", { name: "Show the article above" }).tap();
  await expect(page).toHaveURL(new RegExp(`/t/${tC}$`));
  await ask(page, "And then?");
  await expect(page).toHaveURL(new RegExp(`/t/${tC}/full$`));
  await expect(sheet(page).getByRole("button", { name: "Grit grinds the rock." })).toBeVisible();
  await page.goBack(); // the height was replaced, not added: Back leaves the thread for the article
  await expect(page).toHaveURL(new RegExp(`#/${s1}$`));
});

test.describe("on a laptop", () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false });

  test("asking leaves the panel as it is", async ({ page }) => {
    await withKey(page);
    const { s1, tC } = await seeded(page);
    await fakeClaude(page, { script: ANSWER });
    await page.goto(`/#/${s1}/t/${tC}`);
    await ask(page, "And then?");
    await expect(sheet(page).getByRole("button", { name: "Grit grinds the rock." })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/t/${tC}$`));
  });
});

test("a failed question says why, and Ask again asks once more", async ({ page }) => {
  await withKey(page);
  const { s1, tC } = await seeded(page);
  const sent = await fakeClaude(page, { error: { status: 529, type: "overloaded_error" } }, { script: ANSWER });
  await page.goto(`/#/${s1}/t/${tC}`);
  await ask(page, "And then?");
  await expect(sheet(page).getByText("Anthropic is busy right now. Wait a minute, then ask again.")).toBeVisible();
  await sheet(page).getByRole("button", { name: "Ask again" }).tap();
  await expect(sheet(page).getByRole("button", { name: "Grit grinds the rock." })).toBeVisible();
  await expect(sheet(page).getByText("Anthropic is busy right now")).toBeHidden();
  expect(sent).toHaveLength(2);
});

test("when the code that asks Claude cannot load, the question fails and says so", async ({ page }) => {
  await withKey(page);
  const { s1, tC } = await seeded(page);
  const sent = await fakeClaude(page, { script: ANSWER });
  await page.route("**/src/claude/client.ts*", (route) => route.abort("internetdisconnected"));
  await page.goto(`/#/${s1}/t/${tC}`);
  await ask(page, "And then?");
  await expect(sheet(page).getByText("Could not load the part of the page that asks Claude. Check your connection, then reload the page.")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "Ask again" })).toBeVisible();
  expect(sent).toHaveLength(0);
});

test("a reply cut short by closing the tab is kept as interrupted, and can be asked again", async ({ page }) => {
  await withKey(page);
  const { s1, tC } = await seeded(page);
  const sent = await fakeClaude(page, never(), { script: ANSWER });
  await page.goto(`/#/${s1}/t/${tC}`);
  await ask(page, "And then?");
  await expect(sheet(page).getByText("Claude is thinking")).toBeAttached();
  await expect.poll(() => sent.length).toBe(1); // the call is out, once its code has loaded

  await page.reload(); // the call dies with the page; rule 8 marks it next time
  await expect(sheet(page).getByText("The tab closed before the answer finished. Ask again.")).toBeVisible();
  await sheet(page).getByRole("button", { name: "Ask again" }).tap();
  await expect(sheet(page).getByRole("button", { name: "Grit grinds the rock." })).toBeVisible();
});

test("asked again after a reply cut off mid-way, the cut part stays and Claude is shown thinking", async ({ page }) => {
  await withKey(page);
  const { s1, tC } = await seeded(page);
  const again = held({ script: ANSWER });
  await fakeClaude(page, { script: { pieces: ["The first half arrived. ", "The rest did not."] }, cutAfter: 1 }, again);
  await page.goto(`/#/${s1}/t/${tC}`);
  await ask(page, "And then?");
  await expect(sheet(page).getByText("This answer was cut short.")).toBeVisible();
  await expect(sheet(page).getByRole("button", { name: "The first half arrived." })).toBeVisible(); // kept, and tappable

  await sheet(page).getByRole("button", { name: "Ask again" }).tap();
  await expect(sheet(page).getByText("Claude is thinking")).toBeAttached();
  again.release();
  await expect(sheet(page).getByRole("button", { name: "Grit grinds the rock." })).toBeVisible();
  await expect(sheet(page).getByText("Claude is thinking")).not.toBeAttached();
});

test("with no key, the library asks for one, and a thread points to Settings instead of asking", async ({ page }) => {
  const { s1, tC } = await seeded(page);
  await page.goto("/#/");
  await expect(page.getByRole("region", { name: "Your key" })).toBeVisible();
  await page.goto(`/#/${s1}/t/${tC}`);
  await sheet(page).getByRole("textbox", { name: "Your question" }).fill("Kept for later");
  await sheet(page).getByRole("link", { name: "Add your key to ask" }).tap();
  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole("heading", { name: "Add your Anthropic API key" })).toBeVisible();
});

test("the first time, an empty library offers the key form, and a checked key is kept", async ({ page }) => {
  await fakeClaude(page);
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Settings: add your key" })).toBeVisible();
  await page.getByLabel("API key").fill(KEY);
  await page.getByRole("button", { name: "Check and save" }).tap();
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Add your Anthropic API key" })).toBeHidden();
  await page.getByRole("link", { name: "Settings", exact: true }).tap();
  await expect(page.getByText("Your key ends in WXYZ and is kept in this tab only.")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("region", { name: "Add something to read" })).toBeVisible();
});
