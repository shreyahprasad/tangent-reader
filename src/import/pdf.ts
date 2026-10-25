import { PDF_LINE_BREAK, PDF_MARGIN, PDF_RUNNING, PDF_SCANNED_CHARS } from "../tangent/style";

// A PDF's text rebuilt into paragraphs (docs/design.md, Import). pdf.js gives pieces of text with
// where each sits; these pure functions turn them into lines, drop the running headers, footers
// and page numbers, and join lines into paragraphs, mending words split across lines. Lines are
// built in the order pdf.js gives them, which keeps a two-column page's columns in reading order.

/** One piece of text from pdf.js, with its position (from the page's bottom left, in points). */
export interface PdfItem {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hasEOL: boolean;
}

export interface PdfPage {
  height: number;
  items: PdfItem[];
}

interface Line {
  text: string;
  x: number;
  y: number;
  right: number;
  height: number;
  page: number;
}

/** ﬁ, ﬂ and the rest spelled out; soft hyphens dropped. */
const tidy = (text: string) => text.replace(/[ﬀ-ﬆ]/g, (ch) => ch.normalize("NFKC")).replace(/­/g, "");

/** A page's lines, in pdf.js's order. A line ends where pdf.js says, or where the text moves up or
 *  down by half a line. A gap wider than a fifth of the text's height is a space. */
export function linesOf(page: PdfPage, pageIndex: number): Line[] {
  const lines: Line[] = [];
  let line: Line | null = null;
  const finish = () => {
    const text = line?.text.replace(/\s+/g, " ").trim();
    if (line && text) lines.push({ ...line, text });
    line = null;
  };
  for (const item of page.items) {
    const text = tidy(item.str);
    if (text) {
      const current = line as Line | null;
      if (current && Math.abs(item.y - current.y) > Math.max(current.height, item.height, 1) / 2) finish();
      const open = line as Line | null;
      if (!open) {
        line = { text, x: item.x, y: item.y, right: item.x + item.width, height: item.height, page: pageIndex };
      } else {
        const gap = item.x - open.right;
        const spaced = /\s$/.test(open.text) || /^\s/.test(text);
        open.text += !spaced && gap > Math.max(open.height, item.height) / 5 ? ` ${text}` : text;
        open.right = Math.max(open.right, item.x + item.width);
        open.height = Math.max(open.height, item.height);
      }
    }
    if (item.hasEOL) finish();
  }
  finish();
  return lines;
}

/** A page number on its own: "7", "Page 7", "7 of 12", "vii". */
const PAGE_NUMBER = /^(page\s+)?(\d{1,4}|[ivxlc]{1,7})(\s*(of|\/)\s*\d{1,4})?$/i;
/** Running lines are compared without their numbers: "Smith et al. 3" matches "Smith et al. 4". */
const runningKey = (text: string) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

/** Drops running headers and footers, and page numbers. A running line sits in a page's top or
 *  bottom margin, or is one of its two outermost lines, and repeats across pages; a page number is
 *  a number on its own as the page's highest or lowest line. Templates put their margins anywhere,
 *  so both are checked. */
export function dropRunningLines(pages: Line[][], heights: number[]): Line[][] {
  const outer = pages.map((lines) => {
    const byHeight = [...lines].sort((a, b) => b.y - a.y);
    return { edges: new Set([byHeight[0], byHeight[byHeight.length - 1]]), outermost: new Set([...byHeight.slice(0, 2), ...byHeight.slice(-2)]) };
  });
  const inMargin = (line: Line) => line.y > heights[line.page] * (1 - PDF_MARGIN) || line.y < heights[line.page] * PDF_MARGIN;
  const atEdge = (line: Line) => inMargin(line) || outer[line.page].outermost.has(line);
  const seen = new Map<string, number>();
  for (const lines of pages) {
    for (const key of new Set(lines.filter(atEdge).map((l) => runningKey(l.text)))) seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  const repeated = (line: Line) => pages.length > 1 && (seen.get(runningKey(line.text)) ?? 0) >= Math.max(2, Math.ceil(pages.length * PDF_RUNNING));
  const pageNumber = (line: Line) => PAGE_NUMBER.test(line.text) && (inMargin(line) || outer[line.page].edges.has(line));
  return pages.map((lines) => lines.filter((l) => !((atEdge(l) && repeated(l)) || pageNumber(l))));
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** Whether a line ends a sentence: a full stop, a question or an exclamation, maybe in quotes. */
const endsSentence = (text: string) => /[.!?:]["'’”)\]]*$/.test(text);

/** Lines joined into paragraphs. A paragraph ends at a wider gap than the usual line spacing, a
 *  change of text size (a heading), a first-line indent, or a short line that ends a sentence. */
export function paragraphsOf(lines: Line[]): string[] {
  const hyphenated = hyphenatedWords(lines);
  const steps = lines.slice(1).flatMap((l, i) => {
    const prev = lines[i];
    const step = prev.y - l.y;
    return l.page === prev.page && step > 0 && step < prev.height * 3 ? [step] : [];
  });
  const usual = steps.length ? median(steps) : 0;
  // How far right a full line reaches, for each line's column: the lines that start near it.
  const fullRight = (line: Line) =>
    Math.max(...lines.filter((l) => l.page === line.page && Math.abs(l.x - line.x) < line.height * 2).map((l) => l.right));

  const breaksBefore = (prev: Line, line: Line) => {
    const down = line.page === prev.page && prev.y > line.y;
    if (down && usual && prev.y - line.y > usual * PDF_LINE_BREAK) return true;
    if (Math.abs(line.height - prev.height) > Math.max(line.height, prev.height) * 0.15) return true;
    if (down && line.x - prev.x > line.height * 0.8 && line.x - prev.x < line.height * 4) return true;
    return endsSentence(prev.text) && prev.right < fullRight(prev) - prev.height * 2;
  };

  const paragraphs: string[] = [];
  lines.forEach((line, i) => {
    if (i === 0 || breaksBefore(lines[i - 1], line)) paragraphs.push(line.text);
    else paragraphs[paragraphs.length - 1] = joinLines(paragraphs[paragraphs.length - 1], line.text, hyphenated);
  });
  return paragraphs;
}

/** A word split across lines with a hyphen is mended ("conver-" "sion"); any other line break is a
 *  space. The hyphen stays before a capital or a number ("Jean-" "Paul"), and in a word the
 *  document also writes with a hyphen elsewhere (hyphenated: "matrix-valued" keeps its hyphen if
 *  "matrix-valued" appears on one line somewhere). */
export function joinLines(before: string, after: string, hyphenated: ReadonlySet<string> = new Set()): string {
  if (/\p{Ll}-$/u.test(before) && /^\p{Ll}/u.test(after)) {
    const word = `${/\p{L}+-$/u.exec(before)?.[0] ?? ""}${/^\p{L}+/u.exec(after)?.[0] ?? ""}`.toLowerCase();
    return hyphenated.has(word) ? before + after : before.slice(0, -1) + after;
  }
  return `${before} ${after}`;
}

/** The hyphenated words written whole on a line, lowercased: "matrix-valued". */
export function hyphenatedWords(lines: readonly { text: string }[]): Set<string> {
  return new Set(lines.flatMap((l) => l.text.toLowerCase().match(/\p{L}+-\p{L}+/gu) ?? []));
}

/** The whole document as text: paragraphs apart by a blank line. */
export function rebuildText(pages: PdfPage[]): string {
  const lines = dropRunningLines(
    pages.map((p, i) => linesOf(p, i)),
    pages.map((p) => p.height),
  ).flat();
  return paragraphsOf(lines).join("\n\n");
}

/** Pictures of pages, with no text to read: most pages carry almost no characters. */
export function looksScanned(pages: PdfPage[]): boolean {
  const empty = pages.filter((p) => p.items.reduce((n, i) => n + i.str.replace(/\s/g, "").length, 0) < PDF_SCANNED_CHARS).length;
  return pages.length > 0 && empty / pages.length >= 0.8;
}
