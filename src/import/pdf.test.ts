import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import essay from "../../scripts/pdf-fixtures/essay.txt?raw";
import { dropRunningLines, joinLines, linesOf, looksScanned, paragraphsOf, rebuildText, type PdfItem } from "./pdf";
import { estimateTokens } from "../tangent/tangent";
import { PdfLocked, readPdfPages } from "./pdfjs";

// PDFs read in Node with the same pdf.js build the browser loads. The made-up fixtures are printed
// from one essay by Chrome and by macOS (scripts/pdf-fixtures), so their text must come back as the
// essay, word for word. The arXiv papers are real LaTeX output (fixtures/pdf/README.md).

const fixtures = import.meta.glob<string>("./fixtures/pdf/*.pdf", { query: "?inline", import: "default", eager: true });
const bytes = (name: string) => Uint8Array.from(atob(fixtures[`./fixtures/pdf/${name}`].split(",")[1]), (c) => c.charCodeAt(0));
const read = (name: string, stopAfterTokens = Infinity) => readPdfPages(pdfjs, bytes(name), { stopAfterTokens });
const paragraphs = async (name: string) => rebuildText((await read(name)).pages).split("\n\n");
const ESSAY = essay.trim().split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " "));

describe("PDFs from the tools people use", () => {
  it.each(["chrome-essay.pdf", "chrome-columns.pdf", "quartz-notes.pdf"])("%s comes back as the essay, word for word", async (name) => {
    expect(await paragraphs(name)).toEqual(ESSAY);
  });

  it("drops a running header and a numbered footer, and mends words hyphenated across lines", async () => {
    const text = (await paragraphs("chrome-essay.pdf")).join(" ");
    expect(text).not.toMatch(/Made-up Quarterly|Rivers and time/);
    expect(text).toContain("underestimate the damage"); // printed "un-" / "derestimate"
  });

  it("reads a LaTeX paper: the title first, no margin stamp, no page numbers, words mended", async () => {
    const got = await paragraphs("arxiv-2401.00023.pdf");
    expect(got[0]).toBe("CycleGAN Models for MRI Image Translation");
    expect(got.join(" ")).not.toContain("arXiv:2401.00023");
    expect(got.join(" ")).toContain("medical image synthesis through domain conversion, especially useful");
    expect(got.filter((p) => /^\d+$/.test(p))).toEqual([]);
    expect(got).toContain("1 Introduction");
  });

  it("reads a two-column LaTeX paper in order, and keeps the hyphens the paper uses", async () => {
    const got = await paragraphs("arxiv-2401.00018-pages-1-3.pdf");
    expect(got[0]).toBe("Combining Bayesian reconstruction entropy with maximum entropy method for analytic continuations of matrix-valued Green’s functions");
    expect(got[got.indexOf("I. INTRODUCTION") + 1]).toMatch(/^In quantum many-body physics, single-particle Green’s function holds significant importance/);
    expect(got.join(" ")).toContain("imaginary-time Green’s function");
  });

  it("knows a scan from a PDF with text", async () => {
    expect(looksScanned((await read("scanned.pdf")).pages)).toBe(true);
    for (const name of ["chrome-essay.pdf", "quartz-notes.pdf", "arxiv-2401.00023.pdf"]) expect(looksScanned((await read(name)).pages), name).toBe(false);
  });

  it("says when a PDF is locked with a password", async () => {
    await expect(read("locked.pdf")).rejects.toThrow(PdfLocked);
  });

  it("stops reading once the text passes the size given, and says the page", async () => {
    const stopped = await read("arxiv-2401.00023.pdf", 2000);
    expect(stopped.total).toBe(12);
    expect(stopped.stoppedAt).toBeGreaterThan(1);
    expect(stopped.stoppedAt).toBeLessThan(12);
    expect(stopped.pages).toHaveLength(stopped.stoppedAt!);
    expect((await read("arxiv-2401.00023.pdf")).stoppedAt).toBeNull();
  });

  it("does not stop a PDF whose text fits, counting pdf.js's own spaces once", async () => {
    for (const name of ["arxiv-2401.00023.pdf", "arxiv-2401.00018-pages-1-3.pdf", "chrome-essay.pdf", "quartz-notes.pdf"]) {
      const tokens = estimateTokens(rebuildText((await read(name)).pages));
      expect((await read(name, tokens * 1.1)).stoppedAt, name).toBeNull();
    }
  });

  it("gives the title in a PDF's metadata, when it has one", async () => {
    expect((await read("quartz-notes.pdf")).title).toBe("Untitled"); // junk, which titleFromFile sets aside
    expect((await read("chrome-essay.pdf")).title).toBeNull();
  });
});

// Pieces of text laid out by hand: 10-point text, lines 12 points apart.
const piece = (str: string, x: number, y: number, hasEOL = false, height = 10): PdfItem => ({ str, x, y, width: str.length * 5, height, hasEOL });

describe("rebuilding paragraphs", () => {
  it("puts a space where pieces of a line sit apart, and none where they touch", () => {
    const [line] = linesOf({ height: 800, items: [piece("Rivers", 0, 700), piece("carve", 40, 700), piece("ca", 70, 700), piece("nyons", 80, 700, true)] }, 0);
    expect(line.text).toBe("Rivers carve canyons");
  });

  it("starts a new line where the text moves down, even with no line end", () => {
    const lines = linesOf({ height: 800, items: [piece("One", 0, 700), piece("Two", 0, 688)] }, 0);
    expect(lines.map((l) => l.text)).toEqual(["One", "Two"]);
  });

  it("spells out ligatures and drops soft hyphens", () => {
    expect(linesOf({ height: 800, items: [piece("ﬁeld and ﬂow, co­op", 0, 700, true)] }, 0)[0].text).toBe("field and flow, coop");
  });

  it("mends a word split across lines, but keeps a hyphen before a capital or a known hyphenated word", () => {
    expect(joinLines("domain conver-", "sion, especially")).toBe("domain conversion, especially");
    expect(joinLines("Jean-", "Paul")).toBe("Jean- Paul");
    expect(joinLines("matrix-", "valued", new Set(["matrix-valued"]))).toBe("matrix-valued");
    expect(joinLines("the end.", "Next")).toBe("the end. Next");
  });

  it("drops a header repeated across pages, with its page number, and a lone page number", () => {
    const body = ["Rivers carve.", "Floods move grit.", "Deltas grow."];
    const pages = body.map((text, i) =>
      linesOf({ height: 800, items: [piece(`Journal of Rivers ${i + 1}`, 0, 780, true), piece(text, 0, 600, true), piece(String(i + 1), 300, 20, true)] }, i),
    );
    expect(dropRunningLines(pages, [800, 800, 800]).map((lines) => lines.map((l) => l.text))).toEqual(body.map((text) => [text]));
  });

  it("keeps a line in the margin that does not repeat", () => {
    const pages = [linesOf({ height: 800, items: [piece("A title near the top", 0, 780, true), piece("Body.", 0, 600, true)] }, 0)];
    expect(dropRunningLines(pages, [800]).flat().map((l) => l.text)).toEqual(["A title near the top", "Body."]);
  });

  it("ends a paragraph at a wide gap, a change of size, an indent, or a short line that ends a sentence", () => {
    const at = (items: PdfItem[]) => paragraphsOf(linesOf({ height: 800, items }, 0));
    const full = "x".repeat(60); // a full line is 300 points wide
    // A wide gap.
    expect(at([piece(`${full}`, 0, 700, true), piece("one.", 0, 688, true), piece("Two", 0, 664, true)])).toEqual([`${full} one.`, "Two"]);
    // A heading in bigger text.
    expect(at([piece("Heading", 0, 700, true, 16), piece(full, 0, 684, true), piece("on.", 0, 672, true)])).toEqual(["Heading", `${full} on.`]);
    // A first-line indent.
    expect(at([piece(full, 0, 700, true), piece("end.", 0, 688, true), piece("Next", 15, 676, true)])).toEqual([`${full} end.`, "Next"]);
    // A short line that ends a sentence, then a full one.
    expect(at([piece(full, 0, 700, true), piece("short.", 0, 688, true), piece(full, 0, 676, true)])).toEqual([`${full} short.`, full]);
    // A short line with no full stop runs on.
    expect(at([piece(full, 0, 700, true), piece("short", 0, 688, true), piece("more", 0, 676, true)])).toEqual([`${full} short more`]);
  });

  it("joins a paragraph across a page break", () => {
    const full = "y".repeat(60);
    const pages = [
      { height: 800, items: [piece(full, 0, 700, true), piece(full, 0, 688, true)] },
      { height: 800, items: [piece("continued.", 0, 700, true)] },
    ];
    expect(rebuildText(pages)).toBe(`${full} ${full} continued.`);
  });
});
