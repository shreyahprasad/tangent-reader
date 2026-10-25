import { expect, test, type Page } from "@playwright/test";
import { fakeClaude, seeded, withKey } from "./fake";

// The spending guard (docs/design.md, Asking Claude): a monthly limit set in Settings, a warning at 80%,
// a yes asked for each question past it, and what reading a long article in will cost.

const ANSWER = { pieces: ["Grit grinds the rock. ", "Floods do most of the work."] };
const sheet = (page: Page) => page.getByRole("complementary", { name: "Thread" });
const ask = async (page: Page, question: string) => {
  await sheet(page).getByRole("textbox", { name: "Your question" }).fill(question);
  await sheet(page).getByRole("button", { name: "Ask", exact: true }).tap();
};
const past = (page: Page) => sheet(page).getByRole("alertdialog", { name: "Past your monthly limit" });

// The seeded calls cost $0.0179 each, three of them, in October 2026.
test.beforeEach(({ page }) => page.clock.setFixedTime(new Date("2026-10-14T12:00:00Z")));

test("a limit set in Settings warns at 80%, and past it each question waits for a yes", async ({ page }) => {
  await withKey(page);
  const { s1, tC } = await seeded(page);
  const sent = await fakeClaude(page, { script: ANSWER });

  await page.goto("/#/settings");
  const limit = page.getByRole("textbox", { name: "Monthly limit" });
  await limit.fill("ten");
  await page.getByRole("button", { name: "Set" }).tap();
  await expect(page.getByRole("alert")).toHaveText("Type an amount in dollars, like 10.");
  await limit.fill("$0.06");
  await page.getByRole("button", { name: "Set" }).tap();
  await expect(page.getByText("$0.06 a month.")).toBeVisible();

  await page.goto(`/#/${s1}/t/${tC}`);
  await expect(sheet(page).getByText("You have spent $0.05 of your $0.06 limit this month.")).toBeVisible();

  await page.goto("/#/settings");
  await limit.fill("0.05");
  await page.getByRole("button", { name: "Change" }).tap();
  await page.goto(`/#/${s1}/t/${tC}`);
  await expect(sheet(page).getByText("You are past your $0.05 limit this month, at $0.05.")).toBeVisible();

  await ask(page, "And then?");
  await expect(past(page)).toContainText("Ask anyway?");
  await expect(past(page).getByRole("button", { name: "Ask anyway" })).toBeFocused();
  await sheet(page).getByRole("textbox", { name: "Your question" }).fill("And then what?"); // a change asks again
  await expect(past(page)).toBeHidden();
  await sheet(page).getByRole("button", { name: "Ask", exact: true }).tap();
  await past(page).getByRole("button", { name: "Not now" }).tap();
  await expect(past(page)).toBeHidden();
  expect(sent).toHaveLength(0);

  await sheet(page).getByRole("button", { name: "Ask", exact: true }).tap(); // the draft is kept
  await past(page).getByRole("button", { name: "Ask anyway" }).tap();
  await expect(sheet(page).getByRole("button", { name: "Floods do most of the work." })).toBeVisible();
  expect(sent).toHaveLength(1);
  expect(JSON.stringify(sent[0])).toContain("And then what?");

  await page.goto("/#/settings");
  await page.getByRole("region", { name: "Spending" }).getByRole("button", { name: "Remove" }).tap();
  await expect(limit).toHaveValue("");
  await page.goto(`/#/${s1}/t/${tC}`);
  await expect(sheet(page).getByText(/limit this month/)).toBeHidden();
});

test("past the limit, Ask again waits for a yes too", async ({ page }) => {
  await withKey(page);
  await page.addInitScript(() => localStorage.setItem("tangent-reader:limit", "0.01"));
  const { s1, tC } = await seeded(page);
  const sent = await fakeClaude(page, { error: { status: 529, type: "overloaded_error" } }, { script: ANSWER });
  await page.goto(`/#/${s1}/t/${tC}`);
  await ask(page, "And then?");
  await past(page).getByRole("button", { name: "Ask anyway" }).tap();
  await expect(sheet(page).getByText("Anthropic is busy right now. Wait a minute, then ask again.")).toBeVisible();

  await sheet(page).getByRole("button", { name: "Ask again" }).tap();
  expect(sent).toHaveLength(1);
  await past(page).getByRole("button", { name: "Ask anyway" }).tap();
  await expect(sheet(page).getByRole("button", { name: "Floods do most of the work." })).toBeVisible();
  expect(sent).toHaveLength(2);
});

test("a long article says what its first question costs to read it in, with a search too, until it is cached", async ({ page }) => {
  await withKey(page);
  await fakeClaude(page, { script: ANSWER });
  await page.goto("/");
  // About 30,000 tokens of made-up text.
  const sentence = "Rivers carve canyons over millions of years, grinding grit against the rock below.";
  await page.getByRole("tab", { name: "Paste" }).tap();
  await page.getByRole("textbox", { name: "Article" }).fill(Array.from({ length: 80 }, () => Array(15).fill(sentence).join(" ")).join("\n\n"));
  await page.getByRole("button", { name: "Start reading" }).tap();
  await page.locator('[data-sentence="article|p0:s0"]').tap();

  const readIn = sheet(page).getByText(/^Reading the article in first: about \$0\.\d\d\.$/);
  await expect(readIn).toBeVisible();
  const plain = await readIn.textContent();
  await sheet(page).getByRole("button", { name: "Look it up" }).tap();
  await expect(sheet(page).getByText(/^Reading the article in first, with a search: about \$0\.\d\d\.$/)).toBeVisible();
  await sheet(page).getByRole("button", { name: "Look it up" }).tap();
  await expect(readIn).toHaveText(plain!);

  await ask(page, "Why so slow?");
  await expect(sheet(page).getByRole("button", { name: "Floods do most of the work." })).toBeVisible();
  await expect(sheet(page).getByText(/Reading the article in/)).toBeHidden();
});
