import { ARTICLE_LINK_SHARE, ARTICLE_MIN_CHARS, ARTICLE_PARAGRAPH_CHARS } from "../tangent/style";

// A link, from what you type to the article you read (docs/design.md, Import). The Worker fetches
// the page (worker/fetch.ts) and says what went wrong as a FetchFailure; these words are the
// page's. Pure, and shared with the Worker for the failure's shape.

/** Why the Worker could not hand back a page. */
export type FetchFailure =
  | { error: "bad_link" }
  | { error: "login_in_link" }
  | { error: "port" }
  | { error: "blocked" }
  | { error: "no_such_site" }
  | { error: "unreachable" }
  | { error: "timeout" }
  | { error: "too_many_redirects" }
  | { error: "refused"; status: number }
  | { error: "not_readable"; type: string }
  | { error: "too_big"; limit: string }
  | { error: "rate_limited" }
  | { error: "forbidden" };

const MESSAGES: { [K in FetchFailure["error"]]: (f: Extract<FetchFailure, { error: K }>) => string } = {
  bad_link: () => "That isn't a web link. Links start with https:// or http://.",
  login_in_link: () => "Tangent won't fetch a link with a name or password in it.",
  port: () => "Tangent only fetches links on the usual web ports.",
  blocked: () => "Tangent won't fetch that address: it points inside a private network.",
  no_such_site: () => "That site couldn't be found. Check the link.",
  unreachable: () => "That site didn't answer. Try again later, or paste the text instead.",
  timeout: () => "That site took too long to answer. Try again, or paste the text instead.",
  too_many_redirects: () => "That link sent Tangent through too many redirects to follow.",
  refused: (f) =>
    `That site turned Tangent away (error ${f.status}). Some sites only show their articles in a browser, or to subscribers. Copy the text and paste it instead.`,
  not_readable: () => "That link isn't a web page or a PDF, so Tangent can't read it.",
  too_big: (f) => `That page is too big to read: over ${f.limit}.`,
  rate_limited: () => "That's a lot of links at once. Wait a minute, then try again.",
  forbidden: () => "Tangent couldn't fetch that link from here.",
};

export const failureMessage = (failure: FetchFailure) => (MESSAGES[failure.error] as (f: FetchFailure) => string)(failure);

/** The failures the Internet Archive's copy of a page may get you past: a site that turns
 *  Tangent away, does not answer, or loops. A copy will not help a link that is wrong. */
export const archiveHelps = (failure: FetchFailure) => ["refused", "timeout", "unreachable", "too_many_redirects"].includes(failure.error);

/** The Internet Archive's latest copy of a page, to open in your browser. */
export const archiveLink = (link: string) => `https://web.archive.org/web/${link}`;

/** Whether a reply from the Worker is a failure it described. */
export const isFetchFailure = (body: unknown): body is FetchFailure =>
  typeof (body as { error?: unknown } | null)?.error === "string" && Object.hasOwn(MESSAGES, (body as { error: string }).error);

/** What you typed as a web link, or null. A bare address ("example.com/essay") gets https://. */
export function normalizeLink(input: string): string | null {
  const typed = input.trim();
  if (!typed || /\s/.test(typed)) return null;
  const withScheme = /^[a-z][a-z\d+.-]*:/i.test(typed) ? typed : `https://${typed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname.includes(".") && !url.hostname.startsWith("[")) return null;
    return url.href;
  } catch {
    return null;
  }
}

/** A web address as written, or null for anything else: the only kind of link the page draws. */
export function webLink(ref: string | null): string | null {
  if (!ref) return null;
  try {
    const url = new URL(ref);
    return url.protocol === "https:" || url.protocol === "http:" ? ref : null;
  } catch {
    return null;
  }
}

/** Tracking added to links by newsletters, ads and social sites. */
const TRACKING = /^(utm_.*|fbclid|gclid|dclid|gbraid|wbraid|msclkid|yclid|mc_cid|mc_eid|igshid|_hsenc|_hsmi|mkt_tok)$/i;

/** The link as it is kept with the article: without tracking, otherwise as it was. */
export function cleanLink(link: string): string {
  const url = new URL(link);
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  return url.href.replace(/\?(?=#|$)/, "");
}

/** Whether what Readability found reads as an article, not a home page, an index or a wall:
 *  long enough, not mostly links, and in paragraphs, not headlines. Measured on 14 real pages
 *  (docs/design.md, Import). */
export function looksLikeArticle({ paragraphs, linkChars }: { paragraphs: string[]; linkChars: number }): boolean {
  const chars = paragraphs.reduce((n, p) => n + p.length, 0);
  if (chars < ARTICLE_MIN_CHARS) return false;
  if (linkChars / chars > ARTICLE_LINK_SHARE) return false;
  return chars / paragraphs.length >= ARTICLE_PARAGRAPH_CHARS;
}
