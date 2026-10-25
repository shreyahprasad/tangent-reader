// The headers on every page and file Cloudflare serves (docs/design.md, Security). The build writes
// them as dist/_headers (vite.config.ts), and `vite preview` sends them too, so e2e/csp.built.ts
// checks the built page under them. Not for /fetch: the Worker's own replies are JSON.
//
// XSS is the main threat, since your key may be in the page. So scripts come only from this site,
// and the page can talk only to this site (/fetch) and Anthropic's API. No third-party scripts, no
// analytics, nothing inline or evaluated. React's style={} goes through the DOM, which style-src
// allows.

export const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'self' https://api.anthropic.com",
  "worker-src 'self'", // the PDF reader
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export const HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

/** Cloudflare's _headers file: every path gets HEADERS. */
export const headersFile = () => ["/*", ...Object.entries(HEADERS).map(([name, value]) => `  ${name}: ${value}`), ""].join("\n");
