import { toHash, type View } from "./route";
import type { Via } from "./visits";

// Moving between places, in the browser's history (docs/design.md, Reading and navigation). Each entry
// carries, in history.state, how you got there and where the page and the sheet were scrolled
// when you left, so Back puts both back. Safari's Back and swipe need no code here: a place
// reached without move() is reached by going back.

export interface Scroll {
  page: number;
  sheet: number;
}

interface Entry {
  /** How you got here, until the arrival is logged. */
  via?: Via;
  arrived?: boolean;
  scroll?: Scroll;
}

const entry = (): Entry => (history.state && typeof history.state === "object" ? history.state : {});
const stamp = (patch: Entry) => history.replaceState({ ...entry(), ...patch }, "");

/** The thread's scrolling box, marked by ThreadSheet. The page itself scrolls in the app's
 *  <main>, not the window. */
export const SHEET_SCROLL = "data-sheet-scroll";
const sheetBox = () => document.querySelector<HTMLElement>(`[${SHEET_SCROLL}]`);
const pageBox = () => document.querySelector("main");

/** Goes to a place, saying how, after saving the scroll of the place you leave. A new history
 *  entry unless replace. via null is not a new place (the sheet's height), so nothing is logged. */
export function move(view: View, via: Via | null, { replace = false } = {}) {
  const hash = toHash(view);
  if (hash === location.hash) return;
  stamp({ scroll: { page: pageBox()?.scrollTop ?? 0, sheet: sheetBox()?.scrollTop ?? 0 } });
  if (replace) location.replace(hash);
  else location.hash = hash; // the new entry is current at once; hashchange comes after
  history.replaceState(via ? { via } : { arrived: true }, "");
}

/** How you got to the place on screen: the move that brought you, or else Back, with the scroll
 *  to put back. An entry with no state at all is a link from outside or a typed address. */
export function arrival(): { via: Via; scroll: Scroll | null } {
  const e = entry();
  if (e.via && !e.arrived) return { via: e.via, scroll: null };
  return { via: e.arrived ? "back" : "open", scroll: e.scroll ?? null };
}

/** The arrival is logged: coming back to this entry later is Back. */
export const markArrived = () => stamp({ arrived: true });

export function restoreScroll(scroll: Scroll) {
  cancelAnimationFrame(slide); // Back tapped mid-slide: the slide stops where it is put back
  const page = pageBox();
  if (page) page.scrollTop = scroll.page;
  const sheet = sheetBox();
  if (sheet) sheet.scrollTop = scroll.sheet;
}

let slide = 0;

/** Slides the page until this sentence of the base ("scope|key": the article's, or the answer a
 *  tangent came from) sits its scroll margin (--lit-margin) below the top, over --motion-page, or at
 *  once with Reduce Motion. Our own frames, not scrollIntoView's
 *  smooth scroll, which nothing can stop: a quick Back would land and then be carried on past. */
export function showSentence(id: string) {
  const page = pageBox();
  const sentence = document.querySelector(`[data-sentence="${id}"]`);
  if (!page || !sentence) return;
  cancelAnimationFrame(slide);
  const margin = parseFloat(getComputedStyle(sentence).scrollMarginTop) || 0;
  const offset = sentence.getBoundingClientRect().top - page.getBoundingClientRect().top - margin;
  const from = page.scrollTop;
  const to = Math.max(0, Math.min(page.scrollHeight - page.clientHeight, from + offset));
  const ms = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--motion-page"));
  if (matchMedia("(prefers-reduced-motion: reduce)").matches || !(ms > 0)) {
    page.scrollTop = to;
    return;
  }
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / ms);
    page.scrollTop = from + (to - from) * (1 - (1 - t) ** 5); // close to --ease-page's long soft landing
    if (t < 1) slide = requestAnimationFrame(step);
  };
  slide = requestAnimationFrame(step);
}
