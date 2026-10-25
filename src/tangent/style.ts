/*
 * The page's numbers: limits, thresholds and timings. Colors and sizes live in
 * src/shell/tokens.css.
 */

/** The longest document, in estimated tokens (docs/design.md, Asking Claude). The whole document goes in
 *  every question, so this caps what one costs: about $0.20 to write it to the 1-hour cache on Sonnet 5.5. */
export const DOC_TOKENS = 50_000;

/** Tokens per character, by kind, fitted to Anthropic's count_tokens on made-up texts in seven
 *  scripts on 2026-10-12 (src/tangent/fixtures/tokens). It lands within -6% and +22% of the real
 *  count on each, erring high. Run scripts/count-tokens.mjs again when the models change. */
export const TOKENS_PER_CHAR = {
  /** Chinese, Japanese and Korean: more than one token each. */
  cjk: 1.3,
  /** A to Z and accented Latin letters. */
  latin: 0.33,
  /** Any other alphabet: Cyrillic, Greek, Arabic and the rest. */
  letter: 0.4,
  digit: 1.1,
  space: 0.25,
  /** Punctuation and symbols. */
  other: 0.75,
} as const;

/** The biggest file the import card reads, in bytes. A phone runs out of memory on more. */
export const FILE_BYTES = 50_000_000;

/** A PDF's top and bottom margins, as a share of the page's height: where running headers,
 *  footers and page numbers sit. */
export const PDF_MARGIN = 0.12;

/** A line in a margin is a running header or footer when it repeats on this share of the pages. */
export const PDF_RUNNING = 0.5;

/** A gap between lines this many times the usual one starts a new paragraph. */
export const PDF_LINE_BREAK = 1.35;

/** A page with fewer characters than this has no text to read: a scan, or a picture. */
export const PDF_SCANNED_CHARS = 20;

/** A page is an article, not a home page or a list of links, when its text is at least this
 *  long (about 300 words), at most this share links, and its paragraphs this long on average.
 *  Real articles ran 240 to 550 characters a paragraph and under 20% links; home pages 36 to 68,
 *  or 79% links and up, and product home pages under 2,000 characters. */
export const ARTICLE_MIN_CHARS = 2000;
export const ARTICLE_LINK_SHARE = 0.5;
export const ARTICLE_PARAGRAPH_CHARS = 100;

/** A page's whole <article> is read instead of Readability's pick when it holds this many times
 *  the text: a page that wraps each section in its own container (openai.com) lost all but one. */
export const ARTICLE_WHOLE_GAIN = 1.5;

/** A list item or cell this much link is left out: a table of contents, or related stories. */
export const ARTICLE_LIST_LINKS = 0.8;

/** When a page's paragraphs and headings hold this share of its text, text outside them comes in
 *  only when it reads as prose (this long, or ending a sentence) and is not all but links: the
 *  footnotes Readability left loose on paulgraham.com, not openai.com's row of "Read the technical
 *  report" buttons. Below that share, the page is written in bare divs, and all its text comes in. */
export const ARTICLE_BLOCK_SHARE = 0.7;
export const ARTICLE_LOOSE_CHARS = 100;

/** The most a link's page may weigh: a web page, and a PDF. The Worker reads these. */
export const LINK_HTML_BYTES = 2_000_000;
export const LINK_PDF_BYTES = 20_000_000;

/** The most redirects the Worker follows for one link, each checked again. */
export const LINK_REDIRECTS = 5;

/** How long the Worker gives one link, in ms: its DNS, every redirect and the page itself. */
export const LINK_TIMEOUT_MS = 10_000;

/** Show the size once a document is this close to the limit. */
export const NEAR_LIMIT = 0.8;

/** A dot grows a step at this many messages: --dot-1, --dot-2, --dot-3. Size, not a number:
 *  the dots are a map of where you went, not a counter. */
export const DOT_STEPS = [1, 3, 6] as const;

/** A paragraph with this many anchors shows one bar on the rail instead of a mark each. */
export const RAIL_MERGE = 3;

/** The paste box's height, in lines. */
export const PASTE_ROWS = 12;

/** A title made from the article is its first sentence, cut at a word past this many characters. */
export const TITLE_CHARS = 80;

/** A reply is saved as it arrives, at most this often, in ms. */
export const STREAM_SAVE_MS = 300;

/** A drag on the phone's sheet moves it a stop once past this share of the screen's height. */
export const SHEET_SNAP = 0.12;

/** A drag shorter than this many pixels is a tap on the handle: it toggles half and full. */
export const TAP_SLOP = 6;

/** The visible area this much shorter than the page means the phone's keyboard is up. */
export const KEYBOARD_MIN = 120;

/** Below this width the thread is a sheet over the article (Tailwind's md breakpoint). */
export const PHONE_QUERY = "(max-width: 767.98px)";

/** Visits wait to be saved together: this many at once, or after this long, in ms. Any left go
 *  as the page hides. */
export const VISIT_BATCH = 10;
export const VISIT_FLUSH_MS = 10_000;

/** The most visits the store takes in one batch. */
export const VISITS_PER_BATCH = 200;

/** One session in full carries this many of your last visits. */
export const TRAIL_LENGTH = 30;

/** The path pill shows this many parts ("Article › Why X › How Y"); a longer path folds its middle. */
export const PILL_PARTS = 3;

/** The library's Pick up card shows this many open loops; "All N" shows the rest. */
export const LOOPS_SHOWN = 3;

/** The spending guard (docs/design.md, Asking Claude): at this share of your monthly limit the page warns
 *  you; from all of it, each question asks you to confirm first. */
export const SPEND_WARN_AT = 0.8;

/** Below this, reading an article in is not worth a line before the question. A 12,500-token
 *  article on Sonnet 5.5. */
export const READ_IN_NOTE_FROM_USD = 0.05;
