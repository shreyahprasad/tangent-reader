import { expect, test, type Page } from "@playwright/test";
import { fakeFetch, pickFile } from "./fake";

// Bringing something to read (docs/design.md, Import): the Paste, Link and File tabs of the import
// card, each refusal, and the title shared between tabs. Files are read in the page; a link goes
// through the Worker's /fetch, faked here, so no test touches the internet.

const card = (page: Page) => page.getByRole("region", { name: "Add something to read" });
const tab = (page: Page, name: string) => card(page).getByRole("tab", { name });
const start = (page: Page) => card(page).getByRole("button", { name: "Start reading" });
const title = (page: Page) => card(page).getByRole("textbox", { name: "Title (optional)" });
const paragraphs = (page: Page) => page.getByRole("article", { name: "The article" }).locator("p");

test("a Markdown file comes in as its words, headings and list items as their own paragraphs", async ({ page }) => {
  await page.goto("/");
  await tab(page, "File").tap();
  await expect(title(page)).toHaveAttribute("placeholder", "The file's own title, or its name");
  await pickFile(page, { name: "rivers.md", text: "# How rivers work\n\nRivers carve **canyons**\nover [ages](https://example.com).\n\n- Grit grinds.\n- Floods move it." });
  await expect(card(page).getByText(/^rivers\.md, about \d+ tokens$/)).toBeVisible();
  await expect(title(page)).toHaveAttribute("placeholder", "How rivers work");
  await start(page).tap();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How rivers work");
  await expect(paragraphs(page)).toHaveText(["How rivers work", "Rivers carve canyons over ages.", "Grit grinds.", "Floods move it."]);
  await expect(page.getByText("From rivers.md", { exact: true })).toBeVisible();
});

test("a text file from an older Windows or Mac reads right", async ({ page }) => {
  await page.goto("/");
  await tab(page, "File").tap();
  await pickFile(page, { name: "cafe.txt", bytes: [0x43, 0x61, 0x66, 0xe9, 0x20, 0x93, 0x6f, 0x6b, 0x94, 0x2e] });
  await start(page).tap();
  await expect(paragraphs(page)).toHaveText(["Café “ok”."]);
});

test("a file Tangent cannot read is refused, with the reason", async ({ page }) => {
  await page.goto("/");
  await tab(page, "File").tap();
  await pickFile(page, { name: "photo.jpg", type: "image/jpeg", bytes: [0xff, 0xd8, 0xff] });
  await expect(card(page).getByRole("alert")).toHaveText("Tangent reads PDF, Markdown (.md) and text (.txt) files, not .jpg.");
  await expect(start(page)).toBeDisabled();

  await pickFile(page, { name: "empty.txt", text: " \n\n " });
  await expect(card(page).getByRole("alert")).toHaveText("There's no text in that file.");
  await expect(start(page)).toBeDisabled();
});

test("a file over the size limit is refused whole, with its size", async ({ page }) => {
  await page.goto("/");
  await tab(page, "File").tap();
  await pickFile(page, { name: "long.txt", text: "Rivers carve canyons over ages. ".repeat(14_000) });
  await expect(card(page).getByRole("alert")).toHaveText(
    /^That is about [\d,]+ tokens\. Tangent reads up to 50,000 at a time\. Try a shorter piece, or paste just the part you want\.$/,
  );
  await expect(card(page).getByText("long.txt", { exact: true })).toBeVisible(); // its size only once, in the refusal
  await expect(start(page)).toBeDisabled();
});

const PDF = "/src/import/fixtures/pdf/";

test("a PDF comes in as its paragraphs, without its running header, footer or page numbers", async ({ page }) => {
  await page.goto("/");
  await tab(page, "File").tap();
  await pickFile(page, { name: "chrome-essay.pdf", type: "application/pdf", url: `${PDF}chrome-essay.pdf` });
  await expect(card(page).getByText(/^chrome-essay\.pdf, 4 pages, about [\d,]+ tokens$/)).toBeVisible();
  await expect(title(page)).toHaveAttribute("placeholder", "How Rivers Keep Time");
  await start(page).tap();
  await expect(paragraphs(page)).toHaveCount(11);
  await expect(paragraphs(page).nth(0)).toHaveText("How Rivers Keep Time");
  await expect(paragraphs(page).nth(3)).toContainText("most of it happens during floods, when the river carries more sediment");
  await expect(page.getByRole("article", { name: "The article" })).not.toContainText("Made-up Quarterly");
});

test("a scanned PDF and a locked one are refused, each saying why", async ({ page }) => {
  await page.goto("/");
  await tab(page, "File").tap();
  await pickFile(page, { name: "scan.pdf", type: "application/pdf", url: `${PDF}scanned.pdf` });
  await expect(card(page).getByRole("alert")).toHaveText(
    "This PDF is pictures of pages with no text in them, so Tangent can't read it. A scan needs text recognition (OCR) first.",
  );
  await pickFile(page, { name: "locked.pdf", type: "application/pdf", url: `${PDF}locked.pdf` });
  await expect(card(page).getByRole("alert")).toHaveText("This PDF is locked with a password, so Tangent can't read it.");
  await expect(start(page)).toBeDisabled();
});

// A made-up article inside a page's chrome: a menu, a footer of links, a script.
const ARTICLE = `<!doctype html><html><head><title>How rivers keep time | The Made-up Times</title><script>window.evil = 1</script></head><body>
<nav><a href="/">Home</a> <a href="/world">World</a> <a href="/sport">Sport</a> <a href="/subscribe">Subscribe</a></nav>
<article><h1>How rivers keep time</h1>
${Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i + 1}. A river is the slowest clock most of us will ever look at, and the canyon it cuts records changes that took thousands of years. Standing on a bridge, you see one frame of a long film, and the rest of it is written in the terraces, the gravel and the bends.</p>`).join("\n")}
</article><footer><a href="/a">About</a> <a href="/b">Careers</a> <a href="/c">Privacy</a></footer></body></html>`;
const HOME = `<!doctype html><html><head><title>The Made-up Times</title></head><body>
${Array.from({ length: 40 }, (_, i) => `<p><a href="/story/${i}">Headline number ${i} about the news</a></p>`).join("\n")}</body></html>`;

const linkBox = (page: Page) => card(page).getByRole("textbox", { name: "Link" });
const getPage = (page: Page) => card(page).getByRole("button", { name: "Get the page" });

test("a link comes in as its article, without the page around it", async ({ page }) => {
  await fakeFetch(page, { "https://news.example/rivers": { html: ARTICLE } });
  await page.goto("/");
  await tab(page, "Link").tap();
  await linkBox(page).fill("news.example/rivers");
  await linkBox(page).press("Enter");
  await expect(card(page).getByText(/^news\.example, about [\d,]+ tokens$/)).toBeVisible();
  await expect(title(page)).toHaveAttribute("placeholder", "How rivers keep time");
  await start(page).tap();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("How rivers keep time");
  await expect(paragraphs(page)).toHaveCount(8);
  await expect(paragraphs(page).first()).toHaveText(/^Paragraph 1\. A river is the slowest clock/);
  await expect(page.getByRole("article", { name: "The article" })).not.toContainText(/Subscribe|Careers/);
  expect(await page.evaluate(() => (window as { evil?: number }).evil)).toBeUndefined();
  const source = page.getByRole("link", { name: /^From news\.example/ });
  await expect(source).toHaveAttribute("href", "https://news.example/rivers");
  await expect(source).toHaveAttribute("target", "_blank");
  await expect(source).toHaveAttribute("rel", "noopener noreferrer");
});

test("an article's title is its headline, not the site's name in the first heading", async ({ page }) => {
  await page.goto("/");
  const titles = await page.evaluate(async ([path, para]) => {
    const { articleFromHtml } = (await import(/* @vite-ignore */ path)) as typeof import("../src/import/web");
    const body = (h1s: string) => `<body>${h1s}<article>${para.repeat(25)}</article></body>`;
    const page = (title: string, h1s: string) => `<html><head><title>${title}</title></head>${body(h1s)}</html>`;
    return Promise.all([
      articleFromHtml(page("Why Rust Wins – Acme Blog", "<h1>Acme Blog</h1>")),
      articleFromHtml(page("Why Rust Wins – Acme Blog", "<h1>Acme Blog</h1><h1>Why Rust Wins</h1>")),
    ]).then((found) => found.map((a) => a?.title));
  }, ["/src/import/web.ts", "<p>A paragraph of the post that runs on for a while, long enough to read as an article and not a list of links at all.</p>"] as const);
  expect(titles[0]).toMatch(/^Why Rust Wins/); // Readability's title, never the site's name alone
  expect(titles[1]).toBe("Why Rust Wins");
});

test("a page that wraps each section in its own container comes in whole, without its contents list", async ({ page }) => {
  await page.goto("/");
  const found = await page.evaluate(async ([path]) => {
    const { articleFromHtml } = (await import(/* @vite-ignore */ path)) as typeof import("../src/import/web");
    const sentence = "Water carries grit that grinds the rock, a little in a quiet year and a great deal in a flood. ";
    const section = (n: number) =>
      `<div class="group"><div class="col"><h2><a href="#s${n}">Section ${n}</a></h2>${`<p>Section ${n} says this. ${sentence.repeat(3)}</p>`.repeat(4)}</div></div>`;
    const html = `<html><head><title>Rivers, at length | Made-up Lab</title></head><body><nav><a href="/">Home</a></nav><main><article>
      <h1>Rivers, at length</h1><ul>${[1, 2, 3, 4, 5].map((n) => `<li><a href="#s${n}">Section ${n}</a></li>`).join("")}</ul>
      ${[1, 2, 3, 4, 5].map(section).join("")}</article></main><footer><a href="/terms">Terms</a></footer></body></html>`;
    const article = await articleFromHtml(html);
    return article?.text.split("\n\n") ?? [];
  }, ["/src/import/web.ts"] as const);
  for (const n of [1, 2, 3, 4, 5]) {
    expect(found).toContain(`Section ${n}`); // its heading, though a link
    expect(found.filter((p) => p.startsWith(`Section ${n} says this.`))).toHaveLength(4);
  }
  expect(found.filter((p) => p === "Section 1")).toHaveLength(1); // the contents list is gone
  expect(found.join(" ")).not.toMatch(/Home|Terms/);
});

test("footnotes written with line breaks come in whole, in their place, and a loose button does not", async ({ page }) => {
  await page.goto("/");
  const found = await page.evaluate(async ([path]) => {
    const { articleFromHtml } = (await import(/* @vite-ignore */ path)) as typeof import("../src/import/web");
    const sentence = "Water carries grit that grinds the rock,\na little in a quiet year and a great deal in a flood. ";
    const note = (n: number) => `[<a name="f${n}n"><font color=#000000>${n}</font></a>]\nNote ${n} says this. ${sentence}<br /><br />`;
    const html = `<html><head><title>Rivers</title></head><body><article>
      ${Array.from({ length: 8 }, (_, i) => `<p>Paragraph ${i + 1}. ${sentence.repeat(3)}</p>`).join("")}
      <div><a href="/report">Read the full report</a></div>
      <div>${["Read the full report", "Watch the talk about it", "Listen to the interview", "See the photographs"].map((t) => `<a href="/${t.length}">${t} (opens in a new window)</a>`).join("")}</div>
      <p><b>Notes</b></p>${[1, 2].map(note).join("")}[<a name="f3n"><font color=#000000>3</font></a>]\nA short note.<br /><br />${note(4)}</article></body></html>`;
    const article = await articleFromHtml(html);
    return article?.text.split("\n\n") ?? [];
  }, ["/src/import/web.ts"] as const);
  const long = (n: number) => `[${n}] Note ${n} says this. Water carries grit that grinds the rock, a little in a quiet year and a great deal in a flood.`;
  expect(found.slice(-5)).toEqual(["Notes", long(1), long(2), "[3] A short note.", long(4)]);
  expect(found).toHaveLength(13);
  expect(found.join(" ")).not.toContain("Read the full report");
});

test("a page with no article suggests pasting instead", async ({ page }) => {
  await fakeFetch(page, { "https://news.example/": { html: HOME } });
  await page.goto("/");
  await tab(page, "Link").tap();
  await linkBox(page).fill("https://news.example/");
  await getPage(page).tap();
  await expect(card(page).getByRole("alert")).toHaveText(/^There's no article on this page to read.*copy its text and paste it instead\.$/);
  await expect(start(page)).toBeDisabled();
});

test("a site that turns Tangent away, and a link that is not one, each say why", async ({ page }) => {
  const asked = await fakeFetch(page, { "https://paywall.example/story": { failure: { error: "refused", status: 403 }, status: 502 } });
  await page.goto("/");
  await tab(page, "Link").tap();
  await linkBox(page).fill("https://paywall.example/story");
  await getPage(page).tap();
  await expect(card(page).getByRole("alert")).toHaveText(/^That site turned Tangent away \(error 403\)\./);
  const archive = card(page).getByRole("link", { name: /^open it/ });
  await expect(archive).toHaveAttribute("href", "https://web.archive.org/web/https://paywall.example/story");
  await expect(archive).toHaveAttribute("rel", "noopener noreferrer");
  await linkBox(page).fill("not a link");
  await getPage(page).tap();
  await expect(card(page).getByRole("alert")).toHaveText("That isn't a web link. Links start with https:// or http://.");
  await expect(card(page).getByRole("link", { name: /^open it/ })).toHaveCount(0); // a copy cannot help a wrong link
  expect(asked).toEqual(["https://paywall.example/story"]);
});

test("a link to a PDF is read as a PDF", async ({ page }) => {
  await fakeFetch(page, { "https://papers.example/essay.pdf": { pdf: "src/import/fixtures/pdf/chrome-essay.pdf", url: "https://papers.example/essay.pdf?utm_source=feed" } });
  await page.goto("/");
  await tab(page, "Link").tap();
  await linkBox(page).fill("https://papers.example/essay.pdf");
  await getPage(page).tap();
  await expect(card(page).getByText(/^papers\.example, 4 pages, about [\d,]+ tokens$/)).toBeVisible();
  await expect(title(page)).toHaveAttribute("placeholder", "How Rivers Keep Time");
  // The link stays as typed when you look at another tab and come back.
  await tab(page, "Paste").tap();
  await tab(page, "Link").tap();
  await expect(linkBox(page)).toHaveValue("https://papers.example/essay.pdf");
  await start(page).tap();
  await expect(paragraphs(page)).toHaveCount(11);
  // The link kept is where the PDF ended up, without its tracking.
  await expect(page.getByRole("link", { name: /^From papers\.example/ })).toHaveAttribute("href", "https://papers.example/essay.pdf");
});

test("a PDF link with a stray % in its name still reads", async ({ page }) => {
  await fakeFetch(page, { "https://papers.example/100%.pdf": { pdf: "src/import/fixtures/pdf/chrome-essay.pdf", url: "https://papers.example/100%.pdf" } });
  await page.goto("/");
  await tab(page, "Link").tap();
  await linkBox(page).fill("https://papers.example/100%.pdf");
  await getPage(page).tap();
  await expect(card(page).getByText(/^papers\.example, 4 pages, about/)).toBeVisible();
});

test("each tab keeps its own draft, and the title you type is shared", async ({ page }) => {
  await page.goto("/");
  await tab(page, "Paste").tap();
  await card(page).getByRole("textbox", { name: "Article" }).fill("A pasted line.");
  await tab(page, "File").tap();
  await pickFile(page, { name: "notes.txt", text: "A line from a file." });
  await title(page).fill("My notes");
  await tab(page, "Paste").tap();
  await expect(card(page).getByRole("textbox", { name: "Article" })).toHaveValue("A pasted line.");
  await tab(page, "File").tap();
  await expect(card(page).getByText(/^notes\.txt, about/)).toBeVisible();
  await start(page).tap();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("My notes");
  await expect(paragraphs(page)).toHaveText(["A line from a file."]);
});

test.describe("on a laptop", () => {
  test.use({ hasTouch: false, isMobile: false, viewport: { width: 1280, height: 800 } });

  test("the card opens on Link, and the arrow keys move between tabs, as a screen reader expects", async ({ page }) => {
    await page.goto("/");
    await expect(tab(page, "Link")).toHaveAttribute("aria-selected", "true");
    await expect(card(page).getByRole("textbox", { name: "Link" })).toBeVisible();
    await tab(page, "Link").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "File")).toBeFocused();
    await expect(tab(page, "File")).toHaveAttribute("aria-selected", "true");
    await expect(card(page).getByRole("button", { name: "Choose a file" })).toBeVisible();
    await page.keyboard.press("End");
    await expect(tab(page, "Paste")).toBeFocused();
    await expect(card(page).getByRole("textbox", { name: "Article" })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Link")).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "Paste")).toBeFocused();
  });
});
