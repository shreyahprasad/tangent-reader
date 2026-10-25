import type { FetchFailure } from "../src/import/link";

// What the Worker refuses to fetch (docs/design.md, Import and Security). Pure, so each guard is
// tested on its own. A Worker has no private network behind it, and Cloudflare refuses its
// requests to private addresses anyway; these are the second layer, and they keep the Worker from
// being pointed at itself.

/** Names that only mean something on a local network, and single-label names. */
const LOCAL_NAME = /(^|\.)(localhost|local|internal|home\.arpa|lan|intranet)$/i;

/** The link to fetch, or why not. self is the Worker's own host name. */
export function checkLink(link: string, self: string): { url: URL } | { failure: FetchFailure } {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return { failure: { error: "bad_link" } };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { failure: { error: "bad_link" } };
  if (url.username || url.password) return { failure: { error: "login_in_link" } };
  if (url.port) return { failure: { error: "port" } }; // the URL parser drops a scheme's own port, so any left is another
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.+$/, ""); // "self." is self
  if (host === self.toLowerCase() || LOCAL_NAME.test(host)) return { failure: { error: "blocked" } };
  if (isIP(host)) return blockedAddress(host) ? { failure: { error: "blocked" } } : { url };
  if (!host.includes(".")) return { failure: { error: "blocked" } };
  return { url };
}

const isIP = (host: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(":");

/** IPv4 ranges no public page lives at: [first octets, prefix length]. */
const BLOCKED_V4: [number[], number][] = [
  [[0], 8], // "this network"
  [[10], 8], // private
  [[100, 64], 10], // shared address space (carrier NAT)
  [[127], 8], // loopback
  [[169, 254], 16], // link-local, and the cloud metadata address
  [[172, 16], 12], // private
  [[192, 0, 0], 24], // protocol assignments
  [[192, 0, 2], 24], // documentation
  [[192, 88, 99], 24], // 6to4 relay
  [[192, 168], 16], // private
  [[198, 18], 15], // benchmarking
  [[198, 51, 100], 24], // documentation
  [[203, 0, 113], 24], // documentation
  [[224], 4], // multicast
  [[240], 4], // reserved, and broadcast
];

function v4(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

function inV4(n: number, [octets, prefix]: [number[], number]) {
  const base = [...octets, 0, 0, 0, 0].slice(0, 4).reduce((a, o) => a * 256 + o, 0);
  const size = 2 ** (32 - prefix);
  return n >= base && n < base + size;
}

/** An IPv6 address as eight 16-bit groups, or null. Takes "::" and an IPv4 tail. */
function v6(ip: string): number[] | null {
  let text = ip.toLowerCase();
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail) {
    const n = v4(tail[1]);
    if (n === null) return null;
    text = `${text.slice(0, -tail[1].length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const groups = (s: string) => (s ? s.split(":") : []);
  const [head, rest] = [groups(halves[0]), halves.length === 2 ? groups(halves[1]) : []];
  const missing = 8 - head.length - rest.length;
  if ((halves.length === 2 && missing < 1) || (halves.length === 1 && missing !== 0)) return null;
  const all = [...head, ...Array(Math.max(missing, 0)).fill("0"), ...rest];
  if (all.length !== 8 || all.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return all.map((g) => parseInt(g, 16));
}

/** Whether an address is one no public page lives at. Anything that is not an address is too. */
export function blockedAddress(ip: string): boolean {
  const four = v4(ip);
  if (four !== null) return BLOCKED_V4.some((range) => inV4(four, range));
  const g = v6(ip);
  if (!g) return true;
  const zeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (zeroUpTo(7) && g[7] <= 1) return true; // :: and ::1
  if (zeroUpTo(5) && g[5] === 0xffff) return true; // an IPv4 address carried inside
  if (g[0] === 0x64 && g[1] === 0xff9b) return true; // NAT64, which reaches IPv4
  if (g[0] === 0x2002) return true; // 6to4, which carries IPv4
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard-only
  if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local (private)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  return false;
}

const RECORD = { A: 1, AAAA: 28 } as const;

/** The addresses in a DNS-over-HTTPS JSON answer (RFC 8484's JSON form, as Cloudflare gives it). */
export function parseDns(answer: unknown, type: keyof typeof RECORD): string[] {
  const records = (answer as { Status?: unknown; Answer?: unknown } | null)?.Answer;
  if ((answer as { Status?: unknown } | null)?.Status !== 0 || !Array.isArray(records)) return [];
  return records.filter((r) => r?.type === RECORD[type] && typeof r.data === "string").map((r) => r.data as string);
}
