import { expect, test } from "@playwright/test";

// Demo mode (docs/design.md, Demo): a first-time visitor with no key opens the demo, follows
// a rabbit hole three deep, sees the map, and is asked for a key only to ask something new.

test("the demo opens with no key, branches three deep, and asks for a key only to ask", async ({ page }) => {
  await page.goto("/");
  const sheet = page.getByRole("complementary", { name: "Thread" });
  await page.getByRole("region", { name: "Demo" }).getByRole("button", { name: "Open the demo" }).tap();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ada Lovelace, Note A (1843): demo");
  await expect(page.getByRole("link", { name: /From fourmilab\.ch/ })).toHaveAttribute("href", "https://www.fourmilab.ch/babbage/sketch.html");

  await page.getByRole("button", { name: /^Conversation on "The distinctive characteristic/ }).tap();
  await expect(sheet).toContainText("What was Jacquard's loom?");
  await sheet.getByRole("button", { name: "A hole meant lift, no hole meant stay down.", exact: true }).tap();
  await expect(sheet).toContainText("Where did punched cards go after the loom?");
  await sheet.getByRole("button", { name: /^Cards stayed the everyday way/ }).tap();
  await expect(sheet).toContainText("What replaced them?");
  await expect(sheet.getByRole("link", { name: "Add your key to ask" })).toBeVisible();

  // Opening it again goes to the same session, not a second copy.
  await page.goto("/");
  await expect(page.getByRole("region", { name: "Demo" })).toBeHidden();
  await expect(page.getByRole("region", { name: "Sessions" }).getByRole("link")).toHaveCount(1);
});
