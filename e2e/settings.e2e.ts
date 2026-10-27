import { expect, test } from "@playwright/test";
import { fakeClaude, seeded, withKey } from "./fake";

// Settings (docs/design.md, Screens): the model, the theme, spending, backup, and delete everything.

test("the model you choose answers your next question", async ({ page }) => {
  await withKey(page);
  const { s1, tC } = await seeded(page);
  const sent = (await fakeClaude(page, { script: { pieces: ["Short."], model: "claude-haiku-5-5" } })) as { model: string }[];
  await page.goto("/#/settings");
  await page.getByRole("radio", { name: "Haiku 5.5 (cheaper)" }).check();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Haiku 5.5 (cheaper)" })).toBeChecked();

  await page.goto(`/#/${s1}/t/${tC}`);
  await page.getByRole("textbox", { name: "Your question" }).fill("Shorter?");
  await page.getByRole("button", { name: "Ask", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Short." })).toBeVisible();
  expect(sent.map((r) => r.model)).toEqual(["claude-haiku-5-5"]);
});

test("the page is dark until you pick a theme, and stays picked", async ({ page }) => {
  const DARK = "rgb(28, 31, 36)"; // --bg in src/shell/tokens.css
  const LIGHT = "rgb(242, 242, 247)";
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/#/settings");
  await expect(page.getByRole("radio", { name: "Dark" })).toBeChecked();
  await expect.poll(background).toBe(DARK);

  await page.getByRole("radio", { name: "Light" }).check();
  await expect.poll(background).toBe(LIGHT);
  await page.reload();
  await expect(page.getByRole("radio", { name: "Light" })).toBeChecked();
  await expect.poll(background).toBe(LIGHT);

  await page.getByRole("radio", { name: "Match this device" }).check();
  await expect.poll(background).toBe(LIGHT);
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(background).toBe(DARK);
});

test("spending adds up the call log", async ({ page }) => {
  await seeded(page); // three answers at $0.0179 each, in October 2026
  await page.goto("/#/settings");
  await expect(page.getByRole("region", { name: "Spending" })).toContainText("$0.05 over 3 calls");
});

test("export, delete everything, and import the backup to get it all back", async ({ page }) => {
  await withKey(page);
  await seeded(page);
  await page.goto("/#/settings");
  const saving = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export everything" }).tap();
  const backup = await saving;
  expect(backup.suggestedFilename()).toMatch(/^tangent-reader-\d{4}-\d{2}-\d{2}\.json$/);
  const file = await backup.path(); // never holds the key: transfer.test.ts

  await page.getByRole("button", { name: "Delete everything…" }).tap();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete everything" }).tap();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("region", { name: "Sessions" })).toBeHidden();
  await expect(page.getByRole("heading", { name: "Add your Anthropic API key" })).toBeVisible(); // the key went too

  await page.goto("/#/settings");
  await page.getByLabel("Import a backup").setInputFiles(file);
  await expect(page.getByRole("status")).toHaveText("Added 1 session.");
  await page.goto("/#/");
  await expect(page.getByRole("region", { name: "Sessions" })).toContainText("A test article");
});

test("the top bar links to the source on GitHub, in a new tab, and stays one line on a phone", async ({ page, context }) => {
  // One line: every item in the bar is no taller than the bar's own buttons, and nothing scrolls sideways.
  const oneLine = () =>
    page.evaluate(() => {
      const items = [...document.querySelector("header")!.children].map((e) => e.getBoundingClientRect().height);
      return Math.max(...items) <= 44 && document.documentElement.scrollWidth <= innerWidth;
    });
  const github = page.getByRole("banner").getByRole("link", { name: "GitHub", exact: true });
  await page.goto("/");
  await expect(github).toHaveAttribute("href", "https://github.com/shreyahprasad/tangent-reader");
  await expect(page.getByRole("link", { name: "Settings: add your key" })).toBeVisible();
  await expect(github.getByText("GitHub ↗")).toBeHidden(); // the mark alone on a phone
  expect(await oneLine()).toBe(true);

  await context.route("https://github.com/**", (route) => route.fulfill({ body: "GitHub" }));
  const [tab] = await Promise.all([context.waitForEvent("page"), github.tap()]);
  await expect(tab).toHaveURL("https://github.com/shreyahprasad/tangent-reader");
  await expect(page).toHaveURL(/127\.0\.0\.1/);

  // The narrowest phone: with no key, "Add your key" keeps the room; with one, GitHub is back.
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(github).toBeHidden();
  expect(await oneLine()).toBe(true);
  await withKey(page);
  await page.reload();
  await expect(page.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
  await expect(github).toBeVisible();
  expect(await oneLine()).toBe(true);

  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(github.getByText("GitHub ↗")).toBeVisible();
  expect(await oneLine()).toBe(true);
});
