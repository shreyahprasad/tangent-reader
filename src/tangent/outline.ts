import type { Session, Thread } from "./data";
import { PILL_PARTS } from "./style";
import { unseen } from "./tangent";

// The session as a tree under the article, for the map and the path pill (docs/design.md,
// Screens). Pure and tested (outline.test.ts).

/** A thread as you would name it: your first question in it, or before you ask, its sentence. */
export function threadLabel(session: Pick<Session, "messages">, thread: Thread): string {
  return session.messages.find((m) => m.thread_id === thread.id && m.role === "user")?.text ?? thread.anchor_text;
}

export interface Line {
  thread: Thread;
  /** 0 for an anchor on the article, 1 for a tangent from its answers, and so on. */
  depth: number;
  label: string;
  /** For drawing the tree: for each level above, whether a line runs on down past this one
   *  (that ancestor has more after it), and whether this is the last under its parent. */
  guides: boolean[];
  last: boolean;
  /** The thread open now. */
  here: boolean;
  /** On the way from the article down to the thread open now, that thread included. */
  onPath: boolean;
  /** This thread's own marks; a tangent below shows its own on its own line. */
  unread: boolean;
  waiting: boolean;
  flagged: boolean;
}

/** "p3:s2" as numbers, so p10 sorts after p2. */
const position = (key: string) => key.match(/\d+/g)!.map(Number);
const byPosition = (a: number[], b: number[]) => a[0] - b[0] || a[1] - b[1];

/** Each anchor in article order, its tangents below it in the order of the answers they branched
 *  from, and within one answer, of their sentences. */
export function outline(session: Pick<Session, "threads" | "messages">, here: string | null): Line[] {
  const seq = new Map(session.messages.map((m) => [m.id, m.seq]));
  const order = (t: Thread) => [seq.get(t.from_message_id ?? "") ?? 0, ...position(t.anchor_key)];
  const sorted = [...session.threads].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    return x[0] - y[0] || byPosition(x.slice(1), y.slice(1));
  });
  const byId = new Map(session.threads.map((t) => [t.id, t]));
  const path = new Set<string>();
  for (let t = here ? byId.get(here) : undefined; t; t = t.parent_thread_id ? byId.get(t.parent_thread_id) : undefined) path.add(t.id);
  const lines: Line[] = [];
  const add = (parent: string | null, guides: boolean[]) => {
    const below = sorted.filter((t) => t.parent_thread_id === parent);
    below.forEach((t, i) => {
      const own = session.messages.filter((m) => m.thread_id === t.id);
      const last = i === below.length - 1;
      lines.push({
        thread: t,
        depth: guides.length,
        label: threadLabel(session, t),
        guides,
        last,
        here: t.id === here,
        onPath: path.has(t.id),
        unread: own.some(unseen),
        waiting: own.some((m) => m.status === "pending"),
        flagged: t.flagged,
      });
      add(t.id, [...guides, !last]);
    });
  };
  add(null, []);
  return lines;
}

/** The path pill: "Article", then each thread's label down to this one, the middle folded into
 *  "…" once it is longer than PILL_PARTS. */
export function pillParts(labels: string[]): string[] {
  const parts = ["Article", ...labels];
  return parts.length <= PILL_PARTS ? parts : ["Article", "…", parts[parts.length - 1]];
}
