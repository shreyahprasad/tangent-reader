import { MAX_SEARCHES, WEB_SEARCH_USD } from "../claude/models";
import { webLink } from "../import/link";
import { dateLabel, daysBetween, monthDayLabel, todayISO } from "../shell/dates";
import type { Message, Session, SessionSummary, Source, Thread } from "./data";
import { parseArticle, type Paragraph } from "./sentences";
import { DOC_TOKENS, DOT_STEPS, KEYBOARD_MIN, NEAR_LIMIT, RAIL_MERGE, SHEET_SNAP, TAP_SLOP, TITLE_CHARS, TOKENS_PER_CHAR } from "./style";

// Tangent's page rules, pure and tested (tangent.test.ts). The components only draw what these
// return.

// ── Pasting ──────────────────────────────────────────────────────────────────

/** The text as saved and as split. Windows line endings become \n, so a sentence the page
 *  splits is always found in the text the store saved. */
export function normalizeArticle(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

const count = (n: number) => n.toLocaleString("en-US");

/** The line under an article's title saying where it came from: a link's site, which opens it,
 *  or a file's name. A link is drawn only to a web address. */
export function sourceLine(source: Source, ref: string | null): { text: string; href: string | null } | null {
  if (source === "paste" || ref === null) return null;
  if (source === "file") return { text: `From ${ref}`, href: null };
  const href = webLink(ref);
  return href ? { text: `From ${new URL(href).hostname.replace(/^www\./, "")}`, href } : { text: "From a link", href: null };
}

const CJK = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\uf900-\ufaff]/;
const LATIN = /[A-Za-z\u00c0-\u024f]/;

/** About how many tokens a text is, without asking Anthropic: each character weighs what its
 *  kind costs (style.ts). Tested against measured counts in tangent.test.ts. */
export function estimateTokens(text: string): number {
  const w = TOKENS_PER_CHAR;
  let tokens = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 128) {
      // Plain ASCII, most of most texts, without a regular expression.
      if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) tokens += w.latin;
      else if (c >= 48 && c <= 57) tokens += w.digit;
      else if (c === 32 || (c >= 9 && c <= 13)) tokens += w.space;
      else tokens += w.other;
    } else if (CJK.test(ch)) tokens += w.cjk;
    else if (LATIN.test(ch)) tokens += w.latin;
    else if (/\p{L}/u.test(ch)) tokens += w.letter;
    else if (/\p{Nd}/u.test(ch)) tokens += w.digit;
    else if (/\s/.test(ch)) tokens += w.space;
    else tokens += w.other;
  }
  return Math.round(tokens);
}

const hundreds = (n: number, round: (x: number) => number) => count(round(n / 100) * 100);

/** A size you can read at a glance: "about 1,200 tokens", to the ten under a thousand. */
export function aboutTokens(tokens: number): string {
  const rounded = tokens < 1000 ? Math.max(10, Math.round(tokens / 10) * 10) : Math.round(tokens / 100) * 100;
  return `about ${count(rounded)} tokens`;
}

/** What the import card says about a document's size, and whether it can be saved. Over the
 *  limit is refused, never cut quietly: a paste is told how much to cut, a file or a page to pick a
 *  shorter piece. An over-limit size rounds up, so it never reads as the limit itself. */
export function sizeStatus(text: string, source: Source = "paste"): { canSave: boolean; note: string | null; over: boolean; tokens: number } {
  const article = normalizeArticle(text);
  const tokens = estimateTokens(article);
  if (tokens > DOC_TOKENS) {
    const tail =
      source === "paste"
        ? `, so cut about ${Math.ceil(((tokens - DOC_TOKENS) / tokens) * 100)}% and paste again.`
        : ". Try a shorter piece, or paste just the part you want.";
    return { canSave: false, over: true, tokens, note: `That is about ${hundreds(tokens, Math.ceil)} tokens. Tangent reads up to ${count(DOC_TOKENS)} at a time${tail}` };
  }
  const note = tokens >= DOC_TOKENS * NEAR_LIMIT ? `About ${hundreds(tokens, Math.round)} of ${count(DOC_TOKENS)} tokens.` : null;
  return { canSave: article.length > 0, over: false, tokens, note };
}

/** The title when you leave it blank: the first sentence, cut at a word if it runs long. */
export function defaultTitle(text: string): string {
  const first = parseArticle(normalizeArticle(text))[0]?.sentences[0]?.text ?? "";
  if (first.length <= TITLE_CHARS) return first;
  const cut = first.slice(0, TITLE_CHARS);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : TITLE_CHARS).replace(/[\s,;:]+$/, "")}…`;
}

// ── Marks on the article ─────────────────────────────────────────────────────

/** What an anchored sentence shows: its thread, how much was said, and whether a tangent
 *  hangs below it. */
export interface Mark {
  threadId: string;
  messages: number;
  nested: boolean;
  /** An answer you have not seen, here or in any tangent below. */
  unread: boolean;
  /** A question still waiting for its answer, here or in any tangent below. */
  waiting: boolean;
}

/** Everything the marks show, as one string: equal strings draw the same dots. */
export const marksKey = (marks: Map<string, Mark>) =>
  [...marks].map(([key, m]) => `${key}:${m.threadId}:${m.messages}:${+m.nested}${+m.unread}${+m.waiting}`).join("|");

/** Every thread's mark. unread and waiting gather up from the tangents below, so a dot on the
 *  article leads you down to an answer that landed while you were elsewhere. */
function threadMarks(session: Pick<Session, "threads" | "messages">): Map<string, Mark> {
  const said = new Map<string, number>();
  const unread = new Set<string>();
  const waiting = new Set<string>();
  for (const m of session.messages) {
    said.set(m.thread_id, (said.get(m.thread_id) ?? 0) + 1);
    if (unseen(m)) unread.add(m.thread_id);
    if (m.status === "pending") waiting.add(m.thread_id);
  }
  const children = new Map<string, string[]>();
  for (const t of session.threads) {
    if (t.parent_thread_id) children.set(t.parent_thread_id, [...(children.get(t.parent_thread_id) ?? []), t.id]);
  }
  const marks = new Map<string, Mark>();
  const markOf = (id: string): Mark => {
    const known = marks.get(id);
    if (known) return known;
    const below = (children.get(id) ?? []).map(markOf);
    const mark = {
      threadId: id,
      messages: said.get(id) ?? 0,
      nested: below.length > 0,
      unread: unread.has(id) || below.some((m) => m.unread),
      waiting: waiting.has(id) || below.some((m) => m.waiting),
    };
    marks.set(id, mark);
    return mark;
  };
  session.threads.forEach((t) => markOf(t.id));
  return marks;
}

/** Anchor threads by the article sentence they mark. */
export function anchorMarks(session: Pick<Session, "threads" | "messages">): Map<string, Mark> {
  const marks = threadMarks(session); // has every thread, so each get below finds one
  return new Map(session.threads.filter((t) => t.kind === "anchor").map((t) => [t.anchor_key, marks.get(t.id)!]));
}

/** Tangents by the sentence of this answer they branched from. */
export function tangentMarks(session: Pick<Session, "threads" | "messages">, answerId: string): Map<string, Mark> {
  const marks = threadMarks(session); // has every thread
  return new Map(session.threads.filter((t) => t.from_message_id === answerId).map((t) => [t.anchor_key, marks.get(t.id)!]));
}

/** 0 is a hollow ring (nothing said yet); 1 to 3 are filled dots that grow at DOT_STEPS. */
export function dotStep(messages: number): 0 | 1 | 2 | 3 {
  return DOT_STEPS.filter((step) => messages >= step).length as 0 | 1 | 2 | 3;
}

/** The rail beside a paragraph: a mark per anchor, or one bar once there are RAIL_MERGE or more.
 *  "said" is whether any of them has a conversation. null when nothing is anchored. */
export function railFor(paragraph: Paragraph, marks: Map<string, Mark>): { marks: number; merged: boolean; said: boolean } | null {
  const here = paragraph.sentences.flatMap((s) => marks.get(s.key) ?? []);
  if (here.length === 0) return null;
  return { marks: here.length, merged: here.length >= RAIL_MERGE, said: here.some((m) => m.messages > 0) };
}

/** A tap in flight: an anchor being made shows at once as a hollow dot, and one being undone is
 *  gone at once, so a tap answers before the store does. The saved marks win once reloaded. */
export type Pending = Map<string, "anchor" | "undo">;

export function withPending(saved: Map<string, Mark>, pending: Pending): Map<string, Mark> {
  const shown = new Map(saved);
  for (const [key, action] of pending) {
    if (action === "undo") shown.delete(key);
    else if (!shown.has(key)) shown.set(key, { threadId: "", messages: 0, nested: false, unread: false, waiting: false });
  }
  return shown;
}

/** Taps in flight across the page, keyed "scope|sentence key": the scope is "article" or the
 *  id of the answer the sentence is in. This picks out one scope's. */
export function pendingIn(busy: Map<string, "anchor" | "undo">, scope: string): Pending {
  const prefix = `${scope}|`;
  return new Map([...busy].filter(([k]) => k.startsWith(prefix)).map(([k, action]) => [k.slice(prefix.length), action]));
}

/** What tapping a sentence does: anchor it, undo an anchor nothing was said on, or open its
 *  conversation. */
export function tapAction(mark: Mark | undefined): "anchor" | "undo" | "open" {
  if (mark === undefined) return "anchor";
  return mark.messages === 0 ? "undo" : "open";
}

// ── Threads ──────────────────────────────────────────────────────────────────

/** The threads from the article down to this one: its anchor first. Empty if it is not saved. */
export function pathTo(session: Pick<Session, "threads">, threadId: string): Thread[] {
  const byId = new Map(session.threads.map((t) => [t.id, t]));
  const path: Thread[] = [];
  for (let t = byId.get(threadId); t; t = t.parent_thread_id ? byId.get(t.parent_thread_id) : undefined) path.unshift(t);
  return path;
}

export const threadMessages = (session: Pick<Session, "messages">, threadId: string): Message[] =>
  session.messages.filter((m) => m.thread_id === threadId);

/** Whether any question in the session is still waiting, its reply still arriving included. */
export const isWaiting = (session: Pick<Session, "messages">) => session.messages.some((m) => m.status === "pending");

/** An answer you have not seen. */
export const unseen = (m: Message) => m.role === "assistant" && m.read_at === null;

/** What the open thread is read against, above its sheet (beside it on a laptop): the article for
 *  an anchor, and for a tangent the answer it branched from, its sentence lit. */
export type Base = { kind: "article" } | { kind: "answer"; answer: Message; parent: Thread; lit: string };

export function baseFor(session: Pick<Session, "messages">, path: Thread[]): Base {
  const here = path.at(-1);
  const parent = path.at(-2);
  if (here?.kind !== "tangent" || !parent) return { kind: "article" };
  const answer = session.messages.find((m) => m.id === here.from_message_id);
  return answer ? { kind: "answer", answer, parent, lit: here.anchor_key } : { kind: "article" };
}

/** Where closing a thread lands: one level up. A tangent's parent thread, or for an anchor null,
 *  the article. */
export const closesTo = (path: Thread[]): Thread | null => (path.length > 1 ? path[path.length - 2] : null);

/** Claude is thinking: a question waits and no reply to it has started arriving. Not "the last
 *  message is a question": asked again, a question may sit above the answer cut short before. */
export const isThinking = (messages: Message[]) => isWaiting({ messages }) && !messages.some((m) => m.status === "streaming");

/** Waiting on a question with "Look it up" on: Claude may be searching, and any text it wrote
 *  before a search is dropped, so the wait says so. */
export const isLookingUp = (messages: Message[]) => isThinking(messages) && messages.some((m) => m.status === "pending" && m.search);

/** What "Look it up" adds to a question's cost, beside the switch. */
export const lookItUpCost = () => `About ${Math.round(WEB_SEARCH_USD * 100)}¢ a search, up to ${MAX_SEARCHES}, plus the pages Claude reads.`;

/** Answers in this thread you have not seen. */
export const unreadIn = (messages: Message[]) => messages.some(unseen);

/** Where the phone's sheet settles after a drag of dy pixels (down is positive). A short drag
 *  springs back; past SHEET_SNAP of the screen it moves a stop: full, half, or closed. */
export type Detent = "half" | "full";

export function sheetAfterDrag(from: Detent, dy: number, viewport: number): Detent | "closed" {
  const moved = dy / viewport;
  if (from === "half") return moved < -SHEET_SNAP ? "full" : moved > SHEET_SNAP ? "closed" : "half";
  return moved > SHEET_SNAP * 3 ? "closed" : moved > SHEET_SNAP ? "half" : "full";
}

/** What the phone shows of the page: Safari's visual viewport. */
export interface Viewport {
  height: number;
  offsetTop: number;
}

/** Where the phone's sheet sits, or null to leave it at half height. Full height, and any height
 *  while the keyboard is up, fill exactly the visible area: Safari does not shrink the page for
 *  the keyboard but slides it up, which would push the sheet's top, and its sentence, off screen. */
export function sheetFrame(detent: Detent, view: Viewport, pageHeight: number): { top: number; height: number } | null {
  if (detent === "half" && !keyboardUp(view, pageHeight)) return null;
  return { top: view.offsetTop, height: view.height };
}

/** The visible area well short of the page: the keyboard is up. */
export const keyboardUp = (view: Viewport, pageHeight: number) => pageHeight - view.height > KEYBOARD_MIN;

/** Whether a finger on the sheet's top strip has moved far enough to be a drag. Under that it is
 *  still a tap, so Back and × keep working when a thumb wobbles. */
export const isDrag = (dy: number) => Math.abs(dy) >= TAP_SLOP;

/** What letting go of the sheet's top strip does. A drag settles at a stop, wherever on the
 *  strip it began (the header row too, not just the grey bar). A tap on a button is that button's;
 *  a tap anywhere else on the strip toggles half and full. */
export type Release = { kind: "button" } | { kind: "toggle"; to: Detent } | { kind: "settle"; to: Detent | "closed" };

export function stripRelease(from: Detent, dy: number, onButton: boolean, viewport: number): Release {
  if (isDrag(dy)) return { kind: "settle", to: sheetAfterDrag(from, dy, viewport) };
  if (onButton) return { kind: "button" };
  return { kind: "toggle", to: from === "half" ? "full" : "half" };
}

// ── The library ──────────────────────────────────────────────────────────────

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** "3 threads · 5 questions", or "Not started" before the first anchor. */
export function sessionShape(s: Pick<SessionSummary, "threads" | "questions">): string {
  if (s.threads === 0) return "Not started";
  return s.questions === 0 ? plural(s.threads, "thread") : `${plural(s.threads, "thread")} · ${plural(s.questions, "question")}`;
}

/** "12.4k tokens · $0.04", or null before any call. */
export function sessionUsage(s: Pick<SessionSummary, "tokens" | "cost_usd">): string | null {
  if (s.tokens === 0) return null;
  const tokens = s.tokens >= 1000 ? `${(s.tokens / 1000).toFixed(1)}k` : String(s.tokens);
  return `${tokens} tokens · ${usd(s.cost_usd)}`;
}

/** Dollars to the cent, "$0.04". Something spent that rounds to nothing says so: "under $0.01". */
export const usd = (amount: number) => (amount > 0 && amount < 0.005 ? "under $0.01" : `$${amount.toFixed(2)}`);

/** The day, as you would say it: "Today", "Yesterday", "Oct 3", or "Oct 3, 2025" in another year. */
export function dayLabel(iso: string, now: Date): string {
  const day = todayISO(new Date(iso)); // the timestamp's local date
  const today = todayISO(now);
  const days = daysBetween(day, today);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return day.slice(0, 4) === today.slice(0, 4) ? monthDayLabel(day) : dateLabel(day);
}

/** When you last had a session open, else when it last changed. */
export const lastActive = (s: SessionSummary) => s.last_visit?.at ?? s.updated_at;
