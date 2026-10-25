import type { Source } from "../tangent/data";
import { DOC_TOKENS, FILE_BYTES } from "../tangent/style";
import { decodeText, fileKind, titleFromFile } from "./files";
import { markdownToText } from "./markdown";
import { looksScanned, rebuildText } from "./pdf";
import { browserPdfJs, PdfLocked, readPdfPages } from "./pdfjs";

// Turning what you bring into a draft the import card can start a session from. A refusal is an
// ImportError, whose message is written for you and shown as it is.

/** Something to read, before it is saved. */
export interface Draft {
  text: string;
  source: Source;
  /** The link or the file name. Null for a paste. */
  source_ref: string | null;
  /** The title when you leave yours blank. */
  title: string;
  /** One line about it, under the picker or the link: "notes.pdf, 12 pages". */
  about: string;
}

export class ImportError extends Error {
  /** archive: the Internet Archive's copy of the page, when that may get you past the refusal. */
  constructor(
    message: string,
    readonly archive: string | null = null,
  ) {
    super(message);
  }
}

const mb = (bytes: number) => `${Math.ceil(bytes / 1_000_000)} MB`;

/** Reads a file you picked. onProgress says how far a long read has got. */
export async function readFile(file: File, onProgress?: (note: string) => void): Promise<Draft> {
  const kind = fileKind(file.name, file.type);
  if (!kind) {
    const ext = /\.[^.]+$/.exec(file.name)?.[0];
    throw new ImportError(`Tangent reads PDF, Markdown (.md) and text (.txt) files${ext ? `, not ${ext}` : ""}.`);
  }
  if (file.size > FILE_BYTES) throw new ImportError(`That file is ${mb(file.size)}. Tangent reads files up to ${mb(FILE_BYTES)}.`);
  if (kind === "pdf") return readPdf(file.name, new Uint8Array(await file.arrayBuffer()), onProgress);
  const raw = decodeText(new Uint8Array(await file.arrayBuffer()));
  const text = kind === "markdown" ? markdownToText(raw) : raw;
  if (!text.trim()) throw new ImportError("There's no text in that file.");
  return { text, source: "file", source_ref: file.name, title: titleFromFile(file.name, null, firstParagraph(text)), about: file.name };
}

const count = (n: number) => n.toLocaleString("en-US");
const firstParagraph = (text: string) => text.trim().split(/\n\s*\n/)[0];

/** A PDF's text, from a file or a link (from: what the line under it names). Reading stops a
 *  little past the limit, since the raw text runs longer than the rebuilt: a document near the
 *  limit is read whole and judged on its text. */
export async function readPdf(name: string, data: Uint8Array, onProgress?: (note: string) => void, from = name): Promise<Draft> {
  onProgress?.("Opening the PDF…");
  let read;
  try {
    read = await readPdfPages(await browserPdfJs(), data, {
      onPage: (page, total) => onProgress?.(`Reading page ${count(page)} of ${count(total)}…`),
      stopAfterTokens: DOC_TOKENS * 1.1,
    });
  } catch (e) {
    if (e instanceof PdfLocked) throw new ImportError("This PDF is locked with a password, so Tangent can't read it.");
    throw new ImportError("That PDF could not be read. It may be damaged. Try it again, or paste the text instead.");
  }
  if (read.stoppedAt) {
    throw new ImportError(
      `This PDF runs past ${count(DOC_TOKENS)} tokens by page ${count(read.stoppedAt)} of ${count(read.total)}. Tangent reads up to ${count(DOC_TOKENS)} at a time. Try a shorter piece, or paste just the part you want.`,
    );
  }
  if (looksScanned(read.pages)) {
    throw new ImportError("This PDF is pictures of pages with no text in them, so Tangent can't read it. A scan needs text recognition (OCR) first.");
  }
  const text = rebuildText(read.pages);
  if (!text.trim()) throw new ImportError("There's no text in that PDF.");
  const pages = `${count(read.total)} ${read.total === 1 ? "page" : "pages"}`;
  return { text, source: "file", source_ref: name, title: titleFromFile(name, read.title, firstParagraph(text)), about: `${from}, ${pages}` };
}
