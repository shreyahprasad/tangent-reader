import { estimateTokens } from "../tangent/tangent";
import type { PdfItem, PdfPage } from "./pdf";

// pdf.js, kept at arm's length (docs/design.md, Import). The legacy build, since the modern one
// calls JavaScript that Safari before 26 lacks; loaded only when you pick a PDF, so the page stays
// small for everyone else. Its worker is a separate same-origin file. Fonts are never loaded:
// Tangent only reads the text.

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfPageProxy = Awaited<ReturnType<Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>["getPage"]>>;

/** pdf.js for this browser, loaded the first time it is needed. */
export async function browserPdfJs(): Promise<PdfJs> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url).href;
  return pdfjs;
}

/** The PDF asks for a password. */
export class PdfLocked extends Error {
  name = "PdfLocked";
}

export interface PdfRead {
  pages: PdfPage[];
  /** How many pages the PDF has. */
  total: number;
  /** The title in its metadata, if any. */
  title: string | null;
  /** The page reading stopped at, past the size given; null when every page was read. */
  stoppedAt: number | null;
}

/** Reads the text of every page, saying which page it is on, and stops once the text passes
 *  stopAfterTokens, so a long book is not read whole only to be refused. */
export async function readPdfPages(pdfjs: PdfJs, data: Uint8Array, { onPage, stopAfterTokens }: { onPage?: (page: number, total: number) => void; stopAfterTokens: number }): Promise<PdfRead> {
  const task = pdfjs.getDocument({ data, disableFontFace: true, verbosity: pdfjs.VerbosityLevel.ERRORS });
  try {
    const doc = await task.promise.catch((e: unknown) => {
      throw (e as Error)?.name === "PasswordException" ? new PdfLocked() : e;
    });
    const meta = await doc.getMetadata().catch(() => null);
    const title = (meta?.info as { Title?: unknown } | undefined)?.Title;
    const read: PdfRead = { pages: [], total: doc.numPages, title: typeof title === "string" ? title : null, stoppedAt: null };
    let tokens = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      onPage?.(p, doc.numPages);
      const page = await doc.getPage(p);
      const [, bottom, , top] = page.view;
      const items = await textItems(page, bottom);
      page.cleanup();
      read.pages.push({ height: top - bottom, items });
      tokens += estimateTokens(items.map((i) => i.str + (i.hasEOL ? "\n" : "")).join("")); // pdf.js gives its own spaces
      if (tokens > stopAfterTokens) return { ...read, stoppedAt: p };
    }
    return read;
  } finally {
    await task.destroy();
  }
}

/** A page's text pieces. Not getTextContent: it reads a stream with for await, which Safari before
 *  26 cannot do, so the stream is read here a chunk at a time. */
async function textItems(page: PdfPageProxy, bottom: number): Promise<PdfItem[]> {
  const reader = page.streamTextContent().getReader();
  const items: PdfItem[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return items;
    for (const item of value.items) {
      // Text turned on its side (a stamp in the margin) is not part of the reading.
      if ("str" in item && Math.abs(item.transform[1]) <= Math.abs(item.transform[0])) items.push({ str: item.str, x: item.transform[4], y: item.transform[5] - bottom, width: item.width, height: item.height, hasEOL: item.hasEOL });
    }
  }
}
