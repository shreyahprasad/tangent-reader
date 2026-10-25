import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LINK_HTML_BYTES, LINK_PDF_BYTES } from "../src/tangent/style";
import { decodeHtml, handleFetch, USER_AGENT, type Deps } from "./fetch";

// The Worker's /fetch, with the internet faked: each test says what DNS answers and what each
// address serves. Every guard in docs/design.md, Import, has a test here.

const ORIGIN = "https://tangent-reader.tangent-reader.workers.dev";
const PUBLIC = "93.184.216.34";

type Served = Response | ((init: RequestInit) => Response | Promise<Response>);

function internet({ dns = {}, pages = {}, allow = true }: { dns?: Record<string, string[]>; pages?: Record<string, Served>; allow?: boolean } = {}) {
  const fetched: { url: string; init: RequestInit }[] = [];
  const deps: Deps = {
    resolve: async (host, type) => (dns[host] ?? [PUBLIC]).filter((ip) => (type === "A" ? !ip.includes(":") : ip.includes(":"))),
    fetch: async (url, init) => {
      fetched.push({ url, init });
      const page = pages[url];
      if (!page) return new Response("not found", { status: 404 });
      return typeof page === "function" ? page(init) : page; // each page is fetched once
    },
    allow: async () => allow,
  };
  return { deps, fetched };
}

const ask = (deps: Deps, url: unknown, init: { origin?: string | null; method?: string; headers?: Record<string, string>; body?: string } = {}) => {
  const headers: Record<string, string> = { "content-type": "application/json", ...init.headers };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  return handleFetch(
    new Request(`${ORIGIN}/fetch`, { method: init.method ?? "POST", headers, body: init.method === "GET" ? undefined : (init.body ?? JSON.stringify({ url })) }),
    deps,
  );
};

const html = (body: string, type = "text/html; charset=utf-8", headers: Record<string, string> = {}) => new Response(body, { headers: { "content-type": type, ...headers } });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });
const failure = async (response: Response) => ({ status: response.status, body: await response.json() });

// Nothing about a fetch is ever logged (docs/design.md, Import).
const logs: unknown[] = [];
beforeEach(() => {
  for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...args) => void logs.push(args));
});
afterEach(() => {
  expect(logs).toEqual([]);
  logs.length = 0;
  vi.restoreAllMocks();
});

describe("who may ask", () => {
  it("answers only a POST from the page's own origin", async () => {
    const { deps } = internet();
    expect(await failure(await ask(deps, "https://example.com/", { origin: "https://evil.example" }))).toEqual({ status: 403, body: { error: "forbidden" } });
    expect(await failure(await ask(deps, "https://example.com/", { origin: null }))).toEqual({ status: 403, body: { error: "forbidden" } });
    expect((await ask(deps, "https://example.com/", { method: "GET" })).status).toBe(403);
  });

  it("refuses a caller over the rate limit, before fetching anything", async () => {
    const { deps, fetched } = internet({ allow: false });
    expect(await failure(await ask(deps, "https://example.com/"))).toEqual({ status: 429, body: { error: "rate_limited" } });
    expect(fetched).toEqual([]);
  });

  it("counts the rate limit by the caller's address", async () => {
    const keys: string[] = [];
    const { deps } = internet({ pages: { "https://example.com/": html("<p>hi</p>") } });
    deps.allow = async (key) => (keys.push(key), true);
    await ask(deps, "https://example.com/", { headers: { "cf-connecting-ip": "203.0.113.5" } });
    expect(keys).toEqual(["203.0.113.5"]);
  });

  it("never holds more than a few kilobytes of a request body", async () => {
    const { deps } = internet();
    let pulled = 0;
    const endless = new ReadableStream({ pull: (c) => void (pulled++, c.enqueue(new Uint8Array(1024))) }, { highWaterMark: 0 });
    const request = new Request(`${ORIGIN}/fetch`, { method: "POST", headers: { origin: ORIGIN }, body: endless, duplex: "half" } as RequestInit);
    expect(await failure(await handleFetch(request, deps))).toEqual({ status: 400, body: { error: "bad_link" } });
    expect(pulled).toBeLessThanOrEqual(6);
    const stated = new Request(`${ORIGIN}/fetch`, { method: "POST", headers: { origin: ORIGIN, "content-length": "90000000" }, body: "{}" });
    expect(await failure(await handleFetch(stated, deps))).toEqual({ status: 400, body: { error: "bad_link" } });
  });

  it("refuses a body that is not a link, or is too long", async () => {
    const { deps } = internet();
    expect(await failure(await ask(deps, 42))).toEqual({ status: 400, body: { error: "bad_link" } });
    expect(await failure(await ask(deps, null, { body: "not json" }))).toEqual({ status: 400, body: { error: "bad_link" } });
    expect(await failure(await ask(deps, `https://example.com/${"a".repeat(5000)}`))).toEqual({ status: 400, body: { error: "bad_link" } });
  });
});

describe("what it fetches", () => {
  it("hands back a web page as text, with where it ended up", async () => {
    const { deps } = internet({ pages: { "https://example.com/essay": html("<h1>Rivers</h1><p>Carve.</p>") } });
    const response = await ask(deps, "https://example.com/essay");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ html: "<h1>Rivers</h1><p>Carve.</p>", url: "https://example.com/essay" });
  });

  it("hands back a PDF as its bytes, with where it ended up", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    const { deps } = internet({ pages: { "https://example.com/paper.pdf": new Response(bytes, { headers: { "content-type": "application/pdf" } }) } });
    const response = await ask(deps, "https://example.com/paper.pdf");
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("x-final-url")).toBe("https://example.com/paper.pdf");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it("refuses anything that is neither a web page nor a PDF", async () => {
    const { deps } = internet({ pages: { "https://example.com/a.jpg": new Response("x", { headers: { "content-type": "image/jpeg" } }) } });
    expect(await failure(await ask(deps, "https://example.com/a.jpg"))).toEqual({ status: 415, body: { error: "not_readable", type: "image/jpeg" } });
  });

  it("says when a site turns it away", async () => {
    const { deps } = internet({ pages: { "https://example.com/paywall": new Response("Please enable JS", { status: 403 }) } });
    expect(await failure(await ask(deps, "https://example.com/paywall"))).toEqual({ status: 502, body: { error: "refused", status: 403 } });
  });

  it("sends no cookies or headers of yours, only its own, and keeps none it is sent", async () => {
    const { deps, fetched } = internet({ pages: { "https://example.com/": html("<p>hi</p>", "text/html", { "set-cookie": "session=abc" }) } });
    const response = await ask(deps, "https://example.com/", { headers: { cookie: "mine=1", authorization: "Bearer secret" } });
    expect(fetched[0].init.headers).toEqual({ "user-agent": USER_AGENT, accept: expect.any(String) });
    expect(fetched[0].init.redirect).toBe("manual");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

describe("guards on every hop", () => {
  it("refuses a link that is not http or https, has a login in it, or uses another port", async () => {
    const { deps, fetched } = internet();
    expect((await failure(await ask(deps, "file:///etc/passwd"))).body).toEqual({ error: "bad_link" });
    expect((await failure(await ask(deps, "https://me:pw@example.com/"))).body).toEqual({ error: "login_in_link" });
    expect((await failure(await ask(deps, "http://example.com:6379/"))).body).toEqual({ error: "port" });
    expect(fetched).toEqual([]);
  });

  it("refuses a private address, and a name that resolves to one, after DNS", async () => {
    const { deps, fetched } = internet({ dns: { "sneaky.example": ["10.0.0.5"], "mixed.example": [PUBLIC, "127.0.0.1"], "six.example": ["fd00::1"] } });
    expect((await failure(await ask(deps, "http://169.254.169.254/latest/meta-data/"))).body).toEqual({ error: "blocked" });
    expect((await failure(await ask(deps, "https://sneaky.example/"))).body).toEqual({ error: "blocked" });
    expect((await failure(await ask(deps, "https://mixed.example/"))).body).toEqual({ error: "blocked" });
    expect((await failure(await ask(deps, "https://six.example/"))).body).toEqual({ error: "blocked" });
    expect(fetched).toEqual([]);
  });

  it("refuses a redirect to a private address, or to a name that resolves to one", async () => {
    const { deps, fetched } = internet({
      dns: { "rebind.example": ["192.168.1.1"] },
      pages: { "https://example.com/a": redirect("http://127.0.0.1/admin"), "https://example.com/b": redirect("https://rebind.example/") },
    });
    expect((await failure(await ask(deps, "https://example.com/a"))).body).toEqual({ error: "blocked" });
    expect((await failure(await ask(deps, "https://example.com/b"))).body).toEqual({ error: "blocked" });
    expect(fetched.map((f) => f.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("refuses a redirect to the Worker itself", async () => {
    const { deps } = internet({ pages: { "https://example.com/loop": redirect(`${ORIGIN}/fetch`) } });
    expect((await failure(await ask(deps, "https://example.com/loop"))).body).toEqual({ error: "blocked" });
  });

  it("follows five redirects, each checked, and refuses a sixth", async () => {
    const chain = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`https://example.com/${i}`, redirect(`/${i + 1}`, 301)]));
    const five = internet({ pages: { ...chain(5), "https://example.com/5": html("<p>end</p>") } });
    expect(await (await ask(five.deps, "https://example.com/0")).json()).toEqual({ html: "<p>end</p>", url: "https://example.com/5" });
    const six = internet({ pages: { ...chain(6), "https://example.com/6": html("<p>end</p>") } });
    expect((await failure(await ask(six.deps, "https://example.com/0"))).body).toEqual({ error: "too_many_redirects" });
  });

  it("says when a name has no address", async () => {
    const { deps } = internet({ dns: { "nowhere.example": [] } });
    expect((await failure(await ask(deps, "https://nowhere.example/"))).body).toEqual({ error: "no_such_site" });
  });
});

describe("limits", () => {
  it("refuses a page over the size cap by its stated length, without reading it", async () => {
    let read = false;
    const body = new ReadableStream({ pull: () => void (read = true) }, { highWaterMark: 0 }); // pulls only when read
    const { deps } = internet({ pages: { "https://example.com/": html(body as unknown as string, "text/html", { "content-length": String(LINK_HTML_BYTES + 1) }) } });
    expect(await failure(await ask(deps, "https://example.com/"))).toEqual({ status: 413, body: { error: "too_big", limit: "2 MB" } });
    expect(read).toBe(false);
  });

  it("stops reading a page once it passes the cap, whatever length it stated", async () => {
    const chunk = new Uint8Array(1_000_000);
    let sent = 0;
    const endless = new ReadableStream({ pull: (c) => void (sent++, c.enqueue(chunk)) });
    const { deps } = internet({ pages: { "https://example.com/": () => new Response(endless, { headers: { "content-type": "text/html" } }) } });
    expect((await failure(await ask(deps, "https://example.com/"))).body).toEqual({ error: "too_big", limit: "2 MB" });
    expect(sent).toBeLessThanOrEqual(4);
  });

  it("caps a PDF at its own, larger size", async () => {
    const { deps } = internet({ pages: { "https://example.com/p.pdf": new Response("x", { headers: { "content-type": "application/pdf", "content-length": String(LINK_PDF_BYTES + 1) } }) } });
    expect((await failure(await ask(deps, "https://example.com/p.pdf"))).body).toEqual({ error: "too_big", limit: "20 MB" });
  });

  it("gives up at the deadline, and says so", async () => {
    const { deps } = internet({
      pages: { "https://example.com/slow": (init) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))) as unknown as Response },
    });
    deps.deadline = () => AbortSignal.timeout(20);
    expect(await failure(await ask(deps, "https://example.com/slow"))).toEqual({ status: 504, body: { error: "timeout" } });
  });

  it("says when a site cannot be reached", async () => {
    const { deps } = internet();
    deps.fetch = async () => {
      throw new TypeError("network down");
    };
    expect((await failure(await ask(deps, "https://example.com/"))).body).toEqual({ error: "unreachable" });
  });
});

describe("a page's encoding", () => {
  const cafe = new Uint8Array([0x3c, 0x70, 0x3e, 0x43, 0x61, 0x66, 0xe9, 0x3c, 0x2f, 0x70, 0x3e]); // <p>Café</p> in Windows-1252
  it("reads the charset the header gives", () => {
    expect(decodeHtml(cafe, "text/html; charset=windows-1252")).toBe("<p>Café</p>");
  });
  it("reads the charset a <meta> gives, when the header gives none", () => {
    const meta = new TextEncoder().encode('<meta charset="iso-8859-1">');
    expect(decodeHtml(new Uint8Array([...meta, ...cafe]), "text/html")).toBe('<meta charset="iso-8859-1"><p>Café</p>');
  });
  it("falls back to UTF-8 for a charset it does not know", () => {
    expect(decodeHtml(new TextEncoder().encode("<p>ok</p>"), "text/html; charset=klingon")).toBe("<p>ok</p>");
  });
});
