import { describe, expect, it } from "vitest";
import { markdownToText } from "./markdown";

const paragraphs = (md: string) => markdownToText(md).split("\n\n");

describe("markdown reduced to text", () => {
  it("gives each heading its own paragraph, without its marks", () => {
    expect(paragraphs("# Rivers\n\nThey carve.\n\n## How fast ##\nSlowly.")).toEqual(["Rivers", "They carve.", "How fast", "Slowly."]);
  });

  it("reads underlined headings too", () => {
    expect(paragraphs("Rivers\n======\nThey carve.\n\nHow fast\n--------\nSlowly.")).toEqual(["Rivers", "They carve.", "How fast", "Slowly."]);
  });

  it("joins a paragraph's wrapped lines with a space", () => {
    expect(paragraphs("Rivers carve canyons\nover millions of years.\n\nNext.")).toEqual(["Rivers carve canyons over millions of years.", "Next."]);
  });

  it("drops front matter, rules, comments and link definitions", () => {
    const md = "---\ntitle: Rivers\ndate: 2026-01-01\n---\n\nOne.\n\n***\n\n<!-- a note -->\nTwo.\n\n[ref]: https://example.com/a";
    expect(paragraphs(md)).toEqual(["One.", "Two."]);
  });

  it("keeps a note that opens with a rule, which is not front matter", () => {
    expect(paragraphs("---\n# Intro\n\nThe first part.\n\n---\n\n# Part 2")).toEqual(["Intro", "The first part.", "Part 2"]);
  });

  it("gives each list item its own paragraph, without its marker", () => {
    expect(paragraphs("Steps:\n\n- Wet the rock.\n* Freeze it.\n  + Thaw it.\n1. Repeat.\n12) Wait.")).toEqual([
      "Steps:",
      "Wet the rock.",
      "Freeze it.",
      "Thaw it.",
      "Repeat.",
      "Wait.",
    ]);
  });

  it("keeps a list item's wrapped lines together", () => {
    expect(paragraphs("- Wet the rock\n  and wait.\n- Freeze it.")).toEqual(["Wet the rock and wait.", "Freeze it."]);
  });

  it("takes the quote marks off a quote", () => {
    expect(paragraphs("> Rivers carve.\n> Slowly.\n\nAfter.")).toEqual(["Rivers carve. Slowly.", "After."]);
  });

  it("reduces links, emphasis and code to their words, and drops images", () => {
    expect(markdownToText("See **the [canyon](https://x.y/c)**, _deep_ and ~~wide~~ `rock`. ![a photo](p.png) <https://x.y>")).toBe(
      "See the canyon, deep and wide rock. https://x.y",
    );
    expect(markdownToText("A [reference link][r] and [another] [r2].")).toBe("A reference link and another.");
  });

  it("leaves underscores inside words alone", () => {
    expect(markdownToText("Set snake_case_name and 2*3*4.")).toBe("Set snake_case_name and 2*3*4.");
  });

  it("keeps escaped characters as they are written", () => {
    expect(markdownToText("Not \\*emphasis\\* and a \\# sign.")).toBe("Not *emphasis* and a # sign.");
  });

  it("keeps a code block as one paragraph, line by line", () => {
    expect(paragraphs("Run:\n\n```sh\nmake rock\nmake river\n```\n\nDone.")).toEqual(["Run:", "make rock\nmake river", "Done."]);
    expect(paragraphs("~~~\nindented code\n~~~")).toEqual(["indented code"]);
  });

  it("gives each table row its own line, and drops the line under the header", () => {
    expect(paragraphs("| River | Length |\n|---|---:|\n| Nile | 6,650 km |\n| Amazon | 6,400 km |")).toEqual([
      "River, Length\nNile, 6,650 km\nAmazon, 6,400 km",
    ]);
  });

  it("strips simple HTML and keeps its text", () => {
    expect(markdownToText("One<br>two <b>three</b>.")).toBe("One two three.");
  });

  it("gives nothing for nothing", () => {
    expect(markdownToText("  \n\n---\n")).toBe("");
  });
});
