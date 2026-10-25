import { handleFetch } from "./fetch";
import { parseDns } from "./guards";

// The one Worker (docs/design.md, Architecture): it serves the built page as static assets, and runs
// only for /fetch (wrangler.jsonc's run_worker_first). Here it meets the outside world: DNS over
// HTTPS, Cloudflare's rate limit, and fetch.

interface Env {
  /** Cloudflare's rate limit, per caller, set in wrangler.jsonc. Counted per data center. */
  FETCH_LIMIT: { limit(options: { key: string }): Promise<{ success: boolean }> };
}

/** A host's addresses, from Cloudflare's resolver, so they can be checked before the fetch. */
async function resolve(host: string, type: "A" | "AAAA", signal: AbortSignal): Promise<string[]> {
  const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
    signal,
  });
  if (!response.ok) throw new Error(`DNS answered ${response.status}`);
  return parseDns(await response.json(), type);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== "/fetch") return new Response("Not found", { status: 404 });
    return handleFetch(request, {
      fetch: (url, init) => fetch(url, init),
      resolve,
      allow: async (key) => (await env.FETCH_LIMIT.limit({ key })).success,
    });
  },
};
