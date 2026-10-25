import type { Loop, Session, SessionSummary } from "./data";
import { pillParts, threadLabel } from "./outline";
import type { View } from "./route";
import { LOOPS_SHOWN } from "./style";
import { pathTo } from "./tangent";

// The library's Pick up card (docs/design.md, Screens): where you last were, then the
// threads you left open. Pure and tested (pickup.test.ts).

export interface Resume {
  title: string;
  /** The path to where you were, as the path pill shows it. */
  parts: string[];
  /** Answers you have not seen in that session. */
  unread: boolean;
  view: View;
}

export interface LoopLine {
  key: string;
  label: string;
  /** The session it is in. */
  title: string;
  unread: boolean;
  flagged: boolean;
  view: View;
}

export interface PickUp {
  resume: Resume | null;
  /** LOOPS_SHOWN of them, or every one when all. */
  loops: LoopLine[];
  total: number;
}

/** sessions as the store gives them, most recently visited first; resumed is that session in full,
 *  needed only when you were last in a thread. null when there is nothing to pick up. */
export function pickUp(sessions: SessionSummary[], loops: Loop[], resumed: Pick<Session, "threads" | "messages"> | null, all: boolean): PickUp | null {
  const last = sessions.find((s) => s.last_visit);
  const resume = last ? resumeFrom(last, resumed) : null;
  const here = resume?.view.kind === "thread" ? resume.view.thread : null;
  const open: LoopLine[] = loops
    .filter((l) => l.thread_id !== here)
    .map((l) => ({
      key: l.thread_id,
      label: l.first_question ?? l.anchor_text,
      title: l.session_title,
      unread: l.unread > 0,
      flagged: l.flagged,
      view: { kind: "thread", session: l.session_id, thread: l.thread_id, sheet: "half" },
    }));
  if (!resume && open.length === 0) return null;
  return { resume, loops: all ? open : open.slice(0, LOOPS_SHOWN), total: open.length };
}

/** A thread that is gone lands on the article at its sentence, as route.ts's fallback does. */
function resumeFrom(s: SessionSummary, resumed: Pick<Session, "threads" | "messages"> | null): Resume {
  const v = s.last_visit!;
  const path = v.thread_id && resumed ? pathTo(resumed, v.thread_id) : [];
  const view: View =
    path.length > 0
      ? { kind: "thread", session: s.id, thread: v.thread_id!, sheet: v.sheet ?? "half" }
      : { kind: "article", session: s.id, at: v.anchor_key };
  return { title: s.title, parts: pillParts(path.map((t) => threadLabel(resumed!, t))), unread: s.unread > 0, view };
}
