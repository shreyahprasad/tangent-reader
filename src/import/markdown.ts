// Markdown reduced to the words you read (docs/design.md, Import). Headings, list items and table
// rows keep their own lines, so each becomes a paragraph or a line to tap; marks, links and images
// are taken out. Not a full CommonMark parser: the common shapes of a note or a README, read
// generously. A code block is kept as it is written, since its marks are its words.

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX = /^\s{0,3}#{1,6}(?:\s+(.*?))?(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const UNDERLINE = /^\s{0,3}(=+|-+)\s*$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d{1,9}[.)])\s+(.*)$/;
const QUOTE = /^\s*(?:>\s?)+/;
const LINK_DEFINITION = /^\s{0,3}\[[^\]]+\]:\s*\S+/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
/** A backslash before one of these keeps it as written. */
const ESCAPE = /\\([\\`*_{}[\]()#+\-.!~|>])/g;
/** Emphasis: a mark at a word's edge, around text that starts and ends with a non-space. Marks
 *  inside a word (snake_case, 2*3*4) stay. */
const EMPHASIS = /(^|[^\p{L}\p{N}\\])(\*\*|__|\*|_|~~)(?=\S)(.+?)(?<=\S)\2(?![\p{L}\p{N}])/gu;

interface Block {
  lines: string[];
  /** Lines of a code block or a table stay on their own lines; a paragraph's join with a space. */
  joiner: " " | "\n";
  code: boolean;
}

export function markdownToText(markdown: string): string {
  const lines = markdown
    .replace(/\r\n?/g, "\n")
    .replace(/^﻿/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .split("\n");
  const blocks: Block[] = [];
  let open: Block | null = null;
  const close = () => {
    if (open) blocks.push(open);
    open = null;
  };
  const start = (first: string, joiner: Block["joiner"] = " ") => {
    close();
    open = { lines: [first], joiner, code: false };
  };

  let i = frontMatterEnd(lines);
  for (; i < lines.length; i++) {
    const line = lines[i];
    const fence = FENCE.exec(line);
    if (fence) {
      close();
      const closing = fence[1][0].repeat(fence[1].length);
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith(closing); i++) code.push(lines[i]);
      blocks.push({ lines: code, joiner: "\n", code: true });
      continue;
    }
    if (!line.trim()) {
      close();
      continue;
    }
    if (LINK_DEFINITION.test(line)) continue;
    // A line of = or - under a paragraph underlines it as a heading; on its own, - is a rule.
    if (UNDERLINE.test(line) && open && (open as Block).joiner === " ") {
      close();
      continue;
    }
    if (RULE.test(line)) {
      close();
      continue;
    }
    const heading = ATX.exec(line);
    if (heading) {
      start(heading[1] ?? "");
      close();
      continue;
    }
    if (TABLE_ROW.test(line)) {
      if (TABLE_RULE.test(line)) continue;
      const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      if (open && (open as Block).joiner === "\n") (open as Block).lines.push(cells.join(", "));
      else start(cells.join(", "), "\n");
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      start(item[1]);
      continue;
    }
    const text = line.replace(QUOTE, "").trim();
    if (open) (open as Block).lines.push(text);
    else start(text);
  }
  close();

  return blocks
    .map((b) => (b.code ? b.lines.join("\n") : inline(b.lines.join(b.joiner))).trim())
    .filter(Boolean)
    .join("\n\n");
}

/** Where the text starts: after a front matter block (--- at the very top, to --- or ...), when
 *  its lines read as "key: value". A note that just opens with a rule keeps its first section. */
function frontMatterEnd(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  const end = lines.findIndex((line, i) => i > 0 && (line.trim() === "---" || line.trim() === "..."));
  if (end === -1) return 0;
  const inside = lines.slice(1, end).filter((l) => l.trim());
  return inside.length > 0 && inside.every((l) => /^([\w-]+:(\s|$)|\s+|-\s)/.test(l)) ? end + 1 : 0;
}

/** A line's marks taken out: images dropped, links and code reduced to their words. */
function inline(text: string): string {
  const escaped: string[] = [];
  let out = text
    .replace(ESCAPE, (_, ch: string) => `\u{F0000}${escaped.push(ch) - 1}\u{F0001}`)
    .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\s?\[[^\]]*\]/g, "$1")
    .replace(/<((?:https?|mailto):[^>\s]+)>/g, "$1")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/(`+)(.+?)\1/g, "$2");
  for (let before = ""; before !== out; ) {
    before = out;
    out = out.replace(EMPHASIS, "$1$3");
  }
  return out
    .replace(/\u{F0000}(\d+)\u{F0001}/gu, (_, n: string) => escaped[Number(n)])
    .replace(/[ \t]+/g, " ");
}
