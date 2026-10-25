import { describe, expect, it } from "vitest";
import { CSP, HEADERS, headersFile } from "./headers";

const directives = new Map(CSP.split(";").map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]));

describe("the page's headers", () => {
  it("let scripts come only from this site, with nothing inline or evaluated", () => {
    expect(directives.get("script-src")).toEqual(["'self'"]);
    expect(directives.get("default-src")).toEqual(["'none'"]);
    expect(CSP).not.toMatch(/unsafe|data:|blob:|\*/);
  });

  it("let the page talk only to this site's Worker and Anthropic's API", () => {
    expect(directives.get("connect-src")).toEqual(["'self'", "https://api.anthropic.com"]);
  });

  it("keep the page out of frames, forms and base changes", () => {
    expect(directives.get("frame-ancestors")).toEqual(["'none'"]);
    expect(directives.get("form-action")).toEqual(["'none'"]);
    expect(directives.get("base-uri")).toEqual(["'none'"]);
  });

  it("are written as Cloudflare's _headers file, for every path", () => {
    const lines = headersFile().split("\n");
    expect(lines[0]).toBe("/*");
    expect(lines.slice(1, -1)).toEqual(Object.entries(HEADERS).map(([name, value]) => `  ${name}: ${value}`));
    expect(lines.at(-1)).toBe("");
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(2000); // Cloudflare's limit
  });
});
