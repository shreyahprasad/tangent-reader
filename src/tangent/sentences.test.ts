import { describe, expect, it } from "vitest";
import { flattenSentences, parseArticle } from "./sentences";

/** Sentence strings of a single-paragraph article. */
function sentencesOf(article: string): string[] {
  return flattenSentences(parseArticle(article)).map((sentence) => sentence.text);
}

describe("the calibration cases from the old spec", () => {
  it("keeps abbreviations and honorifics in one sentence", () => {
    expect(sentencesOf("Dr. Smith left the U.S. on Jan. 5th at 3 p.m.")).toEqual([
      "Dr. Smith left the U.S. on Jan. 5th at 3 p.m.",
    ]);
  });

  it("keeps decimals and version numbers in one sentence", () => {
    expect(sentencesOf("The value was 3.14 in v1.2 of the spec.")).toEqual([
      "The value was 3.14 in v1.2 of the spec.",
    ]);
  });

  it("keeps nested punctuation in one sentence", () => {
    expect(sentencesOf('She said, "Wait—is that even possible?" before leaving.')).toEqual([
      'She said, "Wait—is that even possible?" before leaving.',
    ]);
  });
});

describe("splitting still happens where it should", () => {
  it("separates ordinary adjacent sentences", () => {
    expect(sentencesOf("The sky is blue. The grass is green.")).toEqual([
      "The sky is blue.",
      "The grass is green.",
    ]);
  });

  it("separates a sentence that follows an abbreviation-bearing one", () => {
    expect(sentencesOf("Dr. Smith left. He was tired.")).toEqual([
      "Dr. Smith left.",
      "He was tired.",
    ]);
  });

  it("separates on question and exclamation marks", () => {
    expect(sentencesOf("Is that so? I doubt it! Prove it.")).toEqual([
      "Is that so?",
      "I doubt it!",
      "Prove it.",
    ]);
  });

  it("separates a quoted sentence from a following capitalised one", () => {
    expect(sentencesOf('She asked, "Is it possible?" Nobody answered.')).toEqual([
      'She asked, "Is it possible?"',
      "Nobody answered.",
    ]);
  });

  it("handles initials without splitting them apart", () => {
    expect(sentencesOf("J. R. R. Tolkien wrote it. Many people read it.")).toEqual([
      "J. R. R. Tolkien wrote it.",
      "Many people read it.",
    ]);
  });

  it("keeps a citation-style reference attached", () => {
    expect(sentencesOf("See Fig. 2 for details. It shows growth.")).toEqual([
      "See Fig. 2 for details.",
      "It shows growth.",
    ]);
  });

  it('treats a standalone "No." as its own sentence', () => {
    expect(sentencesOf("Was it hard? No. It was easy.")).toEqual([
      "Was it hard?",
      "No.",
      "It was easy.",
    ]);
  });

  it("still keeps the numbering sense of No. attached", () => {
    // Handled by the Segmenter itself: a digit follows, so it declines to split.
    expect(sentencesOf("See No. 5 on the list. It matters.")).toEqual([
      "See No. 5 on the list.",
      "It matters.",
    ]);
  });

  it("keeps e.g. and i.e. mid-sentence", () => {
    expect(sentencesOf("Some fruits, e.g. apples, are sweet. Others are not.")).toEqual([
      "Some fruits, e.g. apples, are sweet.",
      "Others are not.",
    ]);
  });
});

describe("paragraph structure", () => {
  it("splits on blank lines and drops empty blocks", () => {
    const paragraphs = parseArticle("First para. Still first.\n\n\n  \n\nSecond para.");

    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.sentences.map((s) => s.text)).toEqual(["First para.", "Still first."]);
    expect(paragraphs[1]?.sentences.map((s) => s.text)).toEqual(["Second para."]);
  });

  it("keeps a heading-like line with no terminal punctuation as its own sentence", () => {
    const paragraphs = parseArticle("A Heading\n\nThe body follows here.");

    expect(paragraphs[0]?.sentences.map((s) => s.text)).toEqual(["A Heading"]);
  });

  it("normalises CRLF line endings", () => {
    expect(parseArticle("One.\r\n\r\nTwo.")).toHaveLength(2);
  });

  it("returns nothing for blank input", () => {
    expect(parseArticle("")).toEqual([]);
    expect(parseArticle("   \n\n  ")).toEqual([]);
  });
});

describe("sentence keys", () => {
  it("are positional, so repeated sentence text stays distinguishable", () => {
    const sentences = flattenSentences(parseArticle("Yes. No.\n\nYes. Maybe."));
    const repeated = sentences.filter((sentence) => sentence.text === "Yes.");

    expect(repeated.map((sentence) => sentence.key)).toEqual(["p0:s0", "p1:s0"]);
  });

  it("are unique across the whole article", () => {
    const article = Array.from({ length: 20 }, () => "Same sentence. Same sentence.").join("\n\n");
    const keys = flattenSentences(parseArticle(article)).map((sentence) => sentence.key);

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("are stable across repeated parses of the same text", () => {
    const article = "Dr. Smith left. He was tired.\n\nThe value was 3.14.";
    const first = flattenSentences(parseArticle(article));
    const second = flattenSentences(parseArticle(article));

    expect(first).toEqual(second);
  });

  it("carry positions that match document order", () => {
    const sentences = flattenSentences(parseArticle("A one. A two.\n\nB one."));

    expect(sentences.map((s) => [s.paragraphIndex, s.sentenceIndex])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });
});
