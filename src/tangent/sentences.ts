// Text -> paragraphs -> tappable sentences, for an article and for each of Claude's answers
// (docs/design.md, Reading and navigation).
//
// Intl.Segmenter is the base. On its own it splits "Dr. " off as a sentence, and splits after a
// closing quote when the next word is lowercase; both would be broken anchors, so a merge pass
// repairs them. Pure: the same text always gives the same keys, which is what lets a saved
// anchor_key find its sentence again after a reload.

/** One tappable sentence. key is its position, "p3:s2", so repeated text stays two sentences. */
export interface Sentence {
  key: string;
  text: string;
  paragraphIndex: number;
  sentenceIndex: number;
}

export interface Paragraph {
  index: number;
  sentences: Sentence[];
}

/**
 * Merging back onto one of these is safe because a sentence essentially never
 * *ends* on them: they are followed by a name, a number or a unit.
 *
 * Deliberately absent: "no". "No." is a common standalone sentence, and the
 * numbering sense ("See No. 5") is followed by a digit, which the Segmenter
 * already declines to split on without any help from this list.
 */
const ABBREVIATIONS = new Set([
  "dr", "mr", "mrs", "ms", "prof", "sr", "jr", "st", "mt", "ft", "rev", "hon",
  "gen", "col", "capt", "lt", "sgt", "gov", "sen", "rep", "pres", "supt",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
  "vol", "fig", "figs", "eq", "ref", "ch", "chap", "sec", "pp", "ed", "eds",
  "approx", "est", "inc", "ltd", "co", "corp", "dept", "univ", "assn", "bros",
  "vs", "al", "etc", "cf", "ca", "circa",
]);

/** Trailing token of a segment, lowercased and stripped of its final period. */
function trailingToken(text: string): string {
  const match = /([A-Za-z.]+)\.\s*$/.exec(text);
  return match?.[1]?.replace(/\.$/, "").toLowerCase() ?? "";
}

/**
 * True when `segment` is a false split that belongs to the segment before it.
 *
 * Two rules, both narrow, each targeting one observed Segmenter failure:
 *   - the previous segment ends on an abbreviation ("Dr. " + "Smith left.")
 *   - the segment opens lowercase, so it cannot be a sentence start
 *     (""...possible?" " + "before leaving.")
 *
 * A single-letter trailing token also merges, covering initials like "J. R. R."
 * and dotted acronyms like "U.S." that Segmenter sometimes breaks after.
 */
function isFalseSplit(previous: string, segment: string): boolean {
  const opensLowercase = /^\p{Ll}/u.test(segment.trimStart());
  if (opensLowercase) return true;

  const token = trailingToken(previous);
  if (token === "") return false;

  return ABBREVIATIONS.has(token) || token.length === 1;
}

/** Sentence-split one paragraph, repairing the Segmenter's false splits. */
function splitSentences(paragraph: string): string[] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const merged: string[] = [];

  for (const { segment } of segmenter.segment(paragraph)) {
    const previous = merged[merged.length - 1];
    if (previous !== undefined && isFalseSplit(previous, segment)) {
      merged[merged.length - 1] = previous + segment;
    } else {
      merged.push(segment);
    }
  }

  return merged.filter((sentence) => sentence.trim() !== "");
}

/**
 * Split article text into paragraphs of tappable sentences.
 *
 * Keys are positional (`p0:s1`) rather than content-derived, so a sentence that
 * appears twice in an article still has two distinct identities.
 */
export function parseArticle(article: string): Paragraph[] {
  const blocks = article
    .replace(/\r\n?/gu, "\n")
    .split(/\n\s*\n/u)
    .map((block) => block.trim())
    .filter((block) => block !== "");

  return blocks.map((block, paragraphIndex) => {
    const sentences: Sentence[] = splitSentences(block).map((text, sentenceIndex) => ({
      key: `p${paragraphIndex}:s${sentenceIndex}`,
      text: text.trim(),
      paragraphIndex,
      sentenceIndex,
    }));

    return { index: paragraphIndex, sentences };
  });
}

/** Every sentence in the article, flattened into document order. */
export function flattenSentences(paragraphs: readonly Paragraph[]): Sentence[] {
  return paragraphs.flatMap((paragraph) => paragraph.sentences);
}
