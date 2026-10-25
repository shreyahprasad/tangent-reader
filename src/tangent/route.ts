import { href } from "../shell/router";
import type { Visit } from "./data";
import type { Detent } from "./tangent";

// Tangent's addresses, pure and tested (route.test.ts). Every place has one (docs/design.md,
// Reading and navigation):
//   #/                     the library
//   #/<session>            the article
//   #/<session>/at/<key>   the article at that sentence, lit
//   #/<session>/t/<thread> a thread, sheet at half height; /full at full height
// Settings is #/settings (src/app/App.tsx). Session ids are UUIDs, so none is ever "settings".

export type View =
  | { kind: "library" }
  | { kind: "article"; session: string; at: string | null }
  | { kind: "thread"; session: string; thread: string; sheet: Detent };

/** The address, as segments, to a place. Anything half-finished or unknown reads as
 *  the nearest place above it, so an old or mistyped link still lands somewhere. */
export function parse(path: string[]): View {
  const [session, part, id, height] = path;
  if (!session) return { kind: "library" };
  if (part === "t" && id) return { kind: "thread", session, thread: id, sheet: height === "full" ? "full" : "half" };
  return { kind: "article", session, at: part === "at" && id ? id : null };
}

export function toHash(view: View): string {
  if (view.kind === "library") return href();
  if (view.kind === "article") return view.at ? href(view.session, "at", view.at) : href(view.session);
  return view.sheet === "full" ? href(view.session, "t", view.thread, "full") : href(view.session, "t", view.thread);
}

/** Which place this is, leaving out the sheet's height: dragging the sheet is not going anywhere. */
export function placeKey(view: View): string {
  if (view.kind === "library") return "library";
  return view.kind === "article" ? `${view.session}|a|${view.at ?? ""}` : `${view.session}|t|${view.thread}`;
}

/** Where a thread that is gone (an undone anchor, an old link) lands instead: the article at its
 *  sentence, which a thread visit in the trail remembers, else the top of the article. */
export function fallback(view: Extract<View, { kind: "thread" }>, trail: Visit[]): View {
  const seen = trail.find((v) => v.thread_id === view.thread);
  return { kind: "article", session: view.session, at: seen?.anchor_key ?? null };
}
