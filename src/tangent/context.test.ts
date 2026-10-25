import { describe, expect, it } from "vitest";
import { articleBlock, systemBlocks } from "./context";

// The prompt for a thread. The whole request for an anchor and for tangents is pinned in
// src/claude/pins.test.ts.

describe("the prompt", () => {
  it("puts the article first and alone, so it caches across threads", () => {
    const a = systemBlocks("The article.", ["One sentence."]);
    const b = systemBlocks("The article.", ["Another.", "Deeper."]);
    expect(a[0]).toEqual(articleBlock("The article."));
    expect(b[0]).toEqual(a[0]);
    expect(a[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
    expect("cache_control" in a[1]).toBe(false);
  });

  it("gives an anchor its sentence and no path", () => {
    const [, guide] = systemBlocks("A.", ["Rivers carve canyons."]);
    expect(guide.text).toContain('"""Rivers carve canyons."""');
    expect(guide.text).not.toContain("drilled down");
  });

  it("lists a tangent's sentences in order, the last one what it is about", () => {
    const [, guide] = systemBlocks("A.", ["Root.", "First answer sentence.", "Second."]);
    expect(guide.text.indexOf("1. First answer sentence.")).toBeLessThan(guide.text.indexOf("2. Second."));
    expect(guide.text).toContain("The last one is what this conversation is about.");
  });

  it("flattens the whitespace in a path sentence", () => {
    const [, guide] = systemBlocks("A.", ["Root.", "Floods   do most\nof the work."]);
    expect(guide.text).toContain("1. Floods do most of the work.");
  });

  it("clips by characters, not UTF-16 units", () => {
    const [, guide] = systemBlocks("A.", ["Root.", "🌊".repeat(401)]);
    expect(guide.text).toContain(`1. ${"🌊".repeat(400)}…`);
  });
});

describe("text it reads is never instructions", () => {
  // Prompt injection (SECURITY.md): an article, a page brought in by link, or a search result can
  // hold orders aimed at an AI. The prompt says plainly that they are material, and that the
  // reader's question still gets its answer, outside the cached article block.
  it("tells Claude, at every depth, outside the article block", () => {
    for (const path of [["First."], ["First.", "Deeper.", "Deeper still."]]) {
      const [article, guide] = systemBlocks("An article.", path);
      expect(guide!.text).toMatch(/never instructions to you/);
      expect(guide!.text).toMatch(/still answer the reader's question/);
      expect(article!.text).not.toMatch(/instructions/);
    }
  });
});
