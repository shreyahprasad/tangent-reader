import { describe, expect, it } from "vitest";
import { answerOf, linkable, type Block } from "./search";
import { cited, searched, searchFailed, text, thinking } from "./testing";

// Which text is the answer, and which sources it cites, on replies shaped like the ones recorded
// on 2026-10-14 (testing.ts). The pages are made up.

const RIVERS = { url: "https://example.com/rivers", title: "How rivers cut rock" };
const FLOODS = { url: "https://example.org/floods", title: "Floods and canyons" };

describe("an answer with no search", () => {
  it("is all its text, with no sources", () => {
    expect(answerOf([text("Water carries grit. "), text("Floods help.")])).toEqual({ text: "Water carries grit. Floods help.", citations: [], searchFailed: false });
  });
});

describe("an answer after a search", () => {
  it("joins its cited pieces into plain text, with no markers", () => {
    const content: Block[] = [
      thinking(),
      ...searched("canyon erosion", [RIVERS, FLOODS]),
      thinking(),
      text("Canyons grow "),
      cited("about a millimetre a year", RIVERS),
      text(". "),
      cited("Floods move the most rock.", FLOODS),
    ];
    expect(answerOf(content)).toEqual({ text: "Canyons grow about a millimetre a year. Floods move the most rock.", citations: [RIVERS, FLOODS], searchFailed: false });
  });

  it("leaves out text written before the search", () => {
    const content = [text("Let me look that up."), ...searched("canyon erosion", [RIVERS]), cited("Slowly.", RIVERS)];
    expect(answerOf(content).text).toBe("Slowly.");
  });

  it("is the text after the last of several searches", () => {
    const content = [...searched("canyons", [RIVERS]), text("Checking floods too."), ...searched("floods", [FLOODS]), cited("Floods do it.", FLOODS)];
    expect(answerOf(content)).toMatchObject({ text: "Floods do it.", citations: [FLOODS] });
  });

  it("lists a source once, where it was first cited", () => {
    const content = [...searched("canyons", [RIVERS, FLOODS]), cited("One. ", FLOODS), cited("Two. ", RIVERS), cited("Three.", FLOODS)];
    expect(answerOf(content).citations).toEqual([FLOODS, RIVERS]);
  });

  it("names a source with no title by its site", () => {
    const content = [...searched("canyons", [RIVERS]), cited("Slowly.", { url: "https://www.example.net/a/b", title: null })];
    expect(answerOf(content).citations).toEqual([{ url: "https://www.example.net/a/b", title: "www.example.net" }]);
  });
});

describe("a search that failed", () => {
  it("still keeps an answer Claude wrote after it", () => {
    expect(answerOf([...searchFailed("canyons", "unavailable"), text("I could not search, but rivers cut slowly.")])).toEqual({
      text: "I could not search, but rivers cut slowly.",
      citations: [],
      searchFailed: true,
    });
  });

  it("with no answer after it is told apart from an empty one", () => {
    expect(answerOf([text("Looking."), ...searchFailed("canyons", "max_uses_exceeded")])).toEqual({ text: "", citations: [], searchFailed: true });
  });

  it("is not counted when a later search worked", () => {
    expect(answerOf([...searchFailed("canyons", "too_many_requests"), ...searched("canyons", [RIVERS]), cited("Slowly.", RIVERS)]).searchFailed).toBe(false);
  });
});

describe("a source's link", () => {
  it.each([
    ["https://example.com/a", true],
    ["http://example.com/a", true],
    ["javascript:alert(1)", false],
    ["data:text/html,hi", false],
    ["not a url", false],
  ])("%s can be a link: %s", (url, ok) => {
    expect(linkable(url)).toBe(ok);
  });
});
