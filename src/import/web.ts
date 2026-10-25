import { ARTICLE_BLOCK_SHARE, ARTICLE_LIST_LINKS, ARTICLE_LOOSE_CHARS, ARTICLE_WHOLE_GAIN } from "../tangent/style";
import { archiveHelps, archiveLink, cleanLink, failureMessage, isFetchFailure, looksLikeArticle, normalizeLink } from "./link";
import { ImportError, readPdf, type Draft } from "./read";

// A link, read (docs/design.md, Import): the Worker fetches the page, and this browser finds the
// article in it with Readability, loaded only when you use a link. The page is parsed by the
// browser's own DOMParser, which runs no scripts, and only its text is kept. A link to a PDF is
// read as a PDF file is.

/** Fetches a link through the Worker and gives what it holds to read. */
export async function readLink(input: string, onProgress?: (note: string) => void): Promise<Draft> {
  const link = normalizeLink(input);
  if (!link) throw new ImportError(failureMessage({ error: "bad_link" }));
  onProgress?.("Getting the page…");
  let response: Response;
  try {
    response = await fetch("/fetch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: link }) });
  } catch {
    throw new ImportError("Tangent couldn't reach the internet. Check your connection, then try again.");
  }

  if (response.ok && response.headers.get("content-type")?.startsWith("application/pdf")) {
    const final = new URL(response.headers.get("x-final-url") ?? link);
    const last = final.pathname.split("/").filter(Boolean).pop() ?? "";
    const name = (() => {
      try {
        return decodeURIComponent(last);
      } catch {
        return last; // a stray % in the path: keep it as written
      }
    })() || final.hostname;
    const draft = await readPdf(name, new Uint8Array(await response.arrayBuffer()), onProgress, final.hostname);
    return { ...draft, source: "url", source_ref: cleanLink(final.href) };
  }

  const body: unknown = await response.json().catch(() => null);
  const page = body as { html?: unknown; url?: unknown } | null;
  if (!response.ok || typeof page?.html !== "string" || typeof page.url !== "string") {
    if (!isFetchFailure(body)) throw new ImportError("Tangent couldn't fetch that link. Try again, or paste the text instead.", archiveLink(link));
    throw new ImportError(failureMessage(body), archiveHelps(body) ? archiveLink(link) : null);
  }
  onProgress?.("Finding the article…");
  const article = await articleFromHtml(page.html);
  if (!article) {
    throw new ImportError(
      "There's no article on this page to read: it looks like a home page, a list of links or a sign-in wall. If you can see the article in your browser, copy its text and paste it instead.",
      archiveLink(link),
    );
  }
  const host = new URL(page.url).hostname;
  return { text: article.text, source: "url", source_ref: cleanLink(page.url), title: article.title || host, about: host };
}

/** The elements whose text is a paragraph of the article. */
const BLOCKS = "p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, dt, dd, figcaption, th, td";

/** What is never part of the reading: the page's own furniture. */
const FURNITURE = "nav, header, footer, aside, form, button, script, style, noscript, svg, template, iframe, [hidden], [aria-hidden='true'], [role='navigation'], [role='complementary']";

/** The article in a page, as a title and paragraphs, or null when the page holds none. Readability
 *  picks the one container that looks most like an article; a page that wraps each section in its
 *  own container loses all but one, so the page's whole <article> (or <main>) is read too, and
 *  wins when it holds much more (ARTICLE_WHOLE_GAIN) and still reads as an article. Only text is
 *  kept, so the page's links are never resolved: a <base> to do so would break the CSP's base-uri. */
export async function articleFromHtml(html: string): Promise<{ title: string; text: string } | null> {
  const { Readability } = await import("@mozilla/readability");
  const doc = new DOMParser().parseFromString(html, "text/html");
  const headlines = [...doc.querySelectorAll("h1")].map((h) => (h.textContent ?? "").replace(/\s+/g, " ").trim());
  const whole = wholePiece(doc); // before Readability, which changes the document it reads
  const found = new Readability(doc).parse();

  const picked = found?.content ? paragraphsOf(new DOMParser().parseFromString(found.content, "text/html").body) : null;
  const all = whole ? paragraphsOf(whole) : null;
  const size = (text: { paragraphs: string[] } | null) => text?.paragraphs.reduce((n, p) => n + p.length, 0) ?? 0;
  const text = all && size(all) >= size(picked) * ARTICLE_WHOLE_GAIN && looksLikeArticle(all) ? all : picked;
  if (!text || !looksLikeArticle(text)) return null;

  // "Headline | Site": the headline is the title's first part, when a <h1> says it too. Readability
  // keeps the site on a short headline, and the first <h1> is often the site's own name.
  const title = (found?.title ?? doc.title ?? "").trim();
  const first = (doc.title || title).split(/\s+[|\u2013\u2014\u00b7-]\s+/)[0].trim();
  return { title: first && headlines.includes(first) ? first : title, text: text.paragraphs.join("\n\n") };
}

/** The page's own <article> (its longest) or <main>, without its furniture. */
function wholePiece(doc: Document): HTMLElement | null {
  const longest = [...doc.querySelectorAll("article")].sort((a, b) => (b.textContent?.length ?? 0) - (a.textContent?.length ?? 0))[0];
  const root = longest ?? doc.querySelector("main, [role='main']");
  if (!root) return null;
  const copy = root.cloneNode(true) as HTMLElement;
  for (const el of copy.querySelectorAll(FURNITURE)) el.remove();
  return copy;
}

const linkText = (el: Element) => [...el.querySelectorAll("a")].reduce((n, a) => n + (a.textContent?.length ?? 0), 0);
const squeeze = (text: string | null) => (text ?? "").replace(/\s+/g, " ").trim();

/** List items and cells: a list of them that is all links is a contents or related stories. */
const LIST_ITEM = new Set(["LI", "TD", "DD"]);

/** Marks, while the text is broken up: a kept block's place, a break between paragraphs (the
 *  page's own line breaks are only wrapping in its source), and where a link starts and ends. */
const MARK = "\u0000";
const BREAK = "\u0001";
const LINK = ["\u0002", "\u0003"];

/** Each block's text as a paragraph, innermost blocks only, so nothing is said twice, and no list
 *  item that is all but a link (a table of contents, related stories). A paragraph or a heading
 *  always stays, however linked: a blog's headings are links to themselves. Text outside any block
 *  is broken into paragraphs, in its place, by the block elements and line breaks around it: a
 *  parsed page has no layout of its own. It all comes in from a page written in bare divs. From a
 *  page of blocks (ARTICLE_BLOCK_SHARE), only what reads as prose and is not all but links comes
 *  in, such as footnotes Readability left loose, not a row of buttons. An opening bracket alone,
 *  the "[" Readability parts from "1] A note", joins the text after it, which comes in however
 *  short. With how much of what is kept is links. */
function paragraphsOf(body: HTMLElement): { paragraphs: string[]; linkChars: number } {
  const copy = body.cloneNode(true) as HTMLElement;
  const kept: string[] = [];
  let blockLinks = 0;
  for (const el of [...copy.querySelectorAll(BLOCKS)].filter((el) => !el.querySelector(BLOCKS))) {
    const text = el.tagName === "PRE" ? (el.textContent ?? "").trim() : squeeze(el.textContent);
    const links = linkText(el);
    const keep = text && !(LIST_ITEM.has(el.tagName) && links >= text.length * ARTICLE_LIST_LINKS);
    if (keep) blockLinks += links;
    el.replaceWith(keep ? `${BREAK}${MARK}${kept.push(text) - 1}${MARK}${BREAK}` : BREAK);
  }
  const chars = (text: string | null) => (text ?? "").replace(/\s+/g, "").length;
  const blocky = chars(kept.join("")) >= chars(body.textContent) * ARTICLE_BLOCK_SHARE;
  for (const a of copy.querySelectorAll("a")) {
    a.prepend(LINK[0]);
    a.append(LINK[1]);
  }
  for (const el of copy.querySelectorAll(`${BLOCKS}, div, section, article, header, footer, aside, ul, ol, dl, table, tr, br, hr`)) {
    el.before(BREAK);
    el.after(BREAK);
  }
  const paragraphs: string[] = [];
  let lead = "";
  for (const part of (copy.textContent ?? "").split(BREAK)) {
    const mark = new RegExp(`^\\s*${MARK}(\\d+)${MARK}\\s*$`).exec(part);
    const links = [...part.matchAll(new RegExp(`${LINK[0]}([^${LINK[1]}]*)${LINK[1]}`, "g"))].reduce((n, m) => n + squeeze(m[1]).length, 0);
    const text = mark ? kept[Number(mark[1])] : squeeze(part.replace(new RegExp(`[${LINK.join("")}]`, "g"), ""));
    const prose = (text.length >= ARTICLE_LOOSE_CHARS || /[.!?]["'”’)\]]*$/.test(text)) && links < text.length * ARTICLE_LIST_LINKS;
    if (/^[[(]$/.test(text)) lead = text;
    else if (text && (mark || !blocky || prose || lead)) {
      paragraphs.push(lead + text);
      lead = "";
    } else if (text) lead = "";
  }
  if (lead) paragraphs.push(lead);
  return { paragraphs, linkChars: blocky ? blockLinks : linkText(body) };
}
