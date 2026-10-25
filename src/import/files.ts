// A file you pick, read in the browser (docs/design.md, Import): what kind it is, its text, and
// its title. Nothing here leaves the device.

export type FileKind = "pdf" | "markdown" | "text";

/** What the picker offers. An iPhone greys out anything else. */
export const FILE_ACCEPT = ".pdf,.md,.markdown,.txt,application/pdf,text/markdown,text/plain";

/** By the name's extension first, since a phone often gives no type, then by the type. */
export function fileKind(name: string, type: string): FileKind | null {
  const ext = /\.([^.]+)$/.exec(name)?.[1]?.toLowerCase();
  if (ext === "pdf") return "pdf";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "txt") return "text";
  if (ext) return null;
  if (type === "application/pdf") return "pdf";
  if (/^text\/(x-)?markdown$/.test(type)) return "markdown";
  if (type === "text/plain") return "text";
  return null;
}

/** UTF-16 when the file starts with its byte order mark (Notepad's "Unicode"), else UTF-8, or
 *  Windows-1252 when the bytes are not valid UTF-8 (an older Windows or Mac file). */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes); // drops a byte order mark
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** The tools that make PDFs leave these as titles. */
const JUNK_TITLE = [/^untitled\b/i, /^microsoft \w+ - /i, /\.(docx?|pdf|pptx?|xlsx?|txt|md|tex|dvi|odt|rtf|pages|indd)$/i, /^document\s*\d*$/i, /^(slide|presentation)\s*\d*$/i];

/** The name less the extension of a kind Tangent reads; "2401.00018" keeps its dot. */
const withoutExtension = (name: string) => name.replace(/\.(pdf|md|markdown|txt)$/i, "");

/** A first paragraph that reads as a title: short, more than one word, not a sentence. */
const HEADING = /^(?=.*\s)(?!.*[.,;:!?]$).{3,120}$/u;

/** The file's own title when it has a real one; else its first paragraph, when that reads as a
 *  heading (a paper's title, a note's first line); else its name without the extension. */
export function titleFromFile(name: string, metadataTitle?: string | null, firstParagraph?: string): string {
  const title = metadataTitle?.trim() ?? "";
  const named = withoutExtension(name);
  if (title && title !== named && !JUNK_TITLE.some((junk) => junk.test(title))) return title;
  const first = firstParagraph?.replace(/\s+/g, " ").trim() ?? "";
  return HEADING.test(first) ? first : named;
}
