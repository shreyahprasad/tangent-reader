import type { FetchFailure } from "../src/import/link";
import { LINK_HTML_BYTES, LINK_PDF_BYTES, LINK_REDIRECTS, LINK_TIMEOUT_MS } from "../src/tangent/style";
import { blockedAddress, checkLink } from "./guards";

// POST /fetch {url}: the page at a link, for the browser to find the article in (docs/design.md,
// Import). A web page comes back as {html, url}, a PDF as its bytes with the final address in
// X-Final-Url, and anything else as a FetchFailure. Every hop is checked (guards.ts), its host's
// addresses too, and redirects are followed by hand. Nothing you send is passed on: no cookies,
// no headers but our own. Nothing is logged.

/** What the handler needs from the outside world, passed in so tests need no network. */
export interface Deps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** The addresses a host name has, of one type. */
  resolve: (host: string, type: "A" | "AAAA", signal: AbortSignal) => Promise<string[]>;
  /** Whether this caller may fetch now (the rate limit). */
  allow: (key: string) => Promise<boolean>;
  /** The one deadline for the whole fetch: DNS, redirects and body. */
  deadline?: () => AbortSignal;
}

/** How the Worker introduces itself to the sites it fetches. */
export const USER_AGENT = "TangentReader/1 (reads one page for one reader; https://tangent-reader.tangent-reader.workers.dev)";
const ACCEPT = "text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.1";
/** The most a request body may be: a link, in JSON. */
const BODY_BYTES = 4096;

const STATUS: Record<FetchFailure["error"], number> = {
  bad_link: 400,
  login_in_link: 400,
  port: 400,
  blocked: 400,
  no_such_site: 502,
  unreachable: 502,
  timeout: 504,
  too_many_redirects: 502,
  refused: 502,
  not_readable: 415,
  too_big: 413,
  rate_limited: 429,
  forbidden: 403,
};

const NO_STORE = { "cache-control": "no-store" };
/** Lets go of a body not read. Not awaited: a cancel need not finish before we answer. */
const discard = (response: Pick<Response, "body">) => void response.body?.cancel().catch(() => {});
const fail = (failure: FetchFailure) => Response.json(failure, { status: STATUS[failure.error], headers: NO_STORE });
const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`;

export async function handleFetch(request: Request, deps: Deps): Promise<Response> {
  const self = new URL(request.url);
  if (request.method !== "POST" || request.headers.get("origin") !== self.origin) return fail({ error: "forbidden" });
  if (!(await deps.allow(request.headers.get("cf-connecting-ip") ?? "unknown"))) return fail({ error: "rate_limited" });

  const bytes = await readCapped(request, BODY_BYTES); // never more than the cap held in memory
  let link: unknown;
  try {
    link = bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as { url?: unknown }).url : undefined;
  } catch {
    // not JSON
  }
  if (typeof link !== "string") return fail({ error: "bad_link" });

  const signal = deps.deadline?.() ?? AbortSignal.timeout(LINK_TIMEOUT_MS);
  try {
    return await follow(link, self.hostname, deps, signal);
  } catch {
    return fail({ error: signal.aborted ? "timeout" : "unreachable" });
  }
}

async function follow(first: string, self: string, deps: Deps, signal: AbortSignal): Promise<Response> {
  let link = first;
  for (let redirects = 0; ; redirects++) {
    const checked = checkLink(link, self);
    if ("failure" in checked) return fail(checked.failure);
    const { url } = checked;
    const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, "");
    if (!/^[\d.]+$/.test(host) && !host.includes(":")) {
      const addresses = (await Promise.all([deps.resolve(host, "A", signal), deps.resolve(host, "AAAA", signal)])).flat();
      if (addresses.length === 0) return fail({ error: "no_such_site" });
      if (addresses.some(blockedAddress)) return fail({ error: "blocked" });
    }

    const response = await deps.fetch(url.href, { redirect: "manual", signal, headers: { "user-agent": USER_AGENT, accept: ACCEPT } });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      discard(response);
      if (redirects >= LINK_REDIRECTS) return fail({ error: "too_many_redirects" });
      link = new URL(location, url).href;
      continue;
    }
    if (!response.ok) {
      discard(response);
      return fail({ error: "refused", status: response.status });
    }

    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (type.startsWith("application/pdf")) {
      const bytes = await readCapped(response, LINK_PDF_BYTES);
      if (!bytes) return fail({ error: "too_big", limit: mb(LINK_PDF_BYTES) });
      return new Response(bytes, { headers: { "content-type": "application/pdf", "x-final-url": url.href, ...NO_STORE } });
    }
    if (type.startsWith("text/html") || type.startsWith("application/xhtml+xml")) {
      const bytes = await readCapped(response, LINK_HTML_BYTES);
      if (!bytes) return fail({ error: "too_big", limit: mb(LINK_HTML_BYTES) });
      return Response.json({ html: decodeHtml(bytes, type), url: url.href }, { headers: NO_STORE });
    }
    discard(response);
    return fail({ error: "not_readable", type: type.split(";")[0].trim() || "unknown" });
  }
}

/** The body, or null past the cap: refused by its stated length before reading, or as soon as the
 *  bytes read pass it, since a stated length can lie. */
async function readCapped(response: Pick<Response, "headers" | "body">, cap: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (Number(response.headers.get("content-length") ?? 0) > cap) {
    discard(response);
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = response.body?.getReader();
  for (;;) {
    const next = await reader?.read();
    if (!next || next.done) break;
    size += next.value.byteLength;
    if (size > cap) {
      void reader?.cancel().catch(() => {});
      return null;
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.byteLength;
  }
  return bytes;
}

/** A page's text in its own encoding: the header's charset, else a <meta> near the top, else UTF-8. */
export function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const head = new TextDecoder("latin1").decode(bytes.subarray(0, 2048));
  const label = /charset=["']?([\w-]+)/i.exec(contentType)?.[1] ?? /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ?? "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
