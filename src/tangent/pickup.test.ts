import { describe, expect, it } from "vitest";
import type { Loop, Message, SessionSummary, Thread, Visit } from "./data";
import { pickUp } from "./pickup";
import { LOOPS_SHOWN } from "./style";

const at = "2026-10-09T10:00:00.000Z";

const summary = (id: string, last_visit: Visit | null, unread = 0): SessionSummary => ({
  id,
  title: `title ${id}`,
  created_at: at,
  updated_at: at,
  threads: 0,
  questions: 0,
  unread,
  pending: 0,
  flagged: 0,
  tokens: 0,
  cost_usd: 0,
  last_visit,
});

const visit = (extra: Partial<Visit>): Visit => ({ seq: 1, at, view: "article", thread_id: null, anchor_key: null, sheet: null, via: "open", ...extra });

const thread = (id: string, parent: string | null = null): Thread => ({
  id,
  kind: parent ? "tangent" : "anchor",
  parent_thread_id: parent,
  from_message_id: null,
  anchor_key: "p0:s0",
  anchor_text: `sentence of ${id}`,
  flagged: false,
  created_at: at,
});

const question = (threadId: string, text: string): Message => ({
  id: `m-${threadId}`,
  thread_id: threadId,
  seq: 1,
  role: "user",
  text,
  status: "done",
  error: null,
  search: false,
  citations: [],
  call_id: null,
  truncated: false,
  read_at: null,
  created_at: at,
});

const loop = (thread_id: string, extra: Partial<Loop> = {}): Loop => ({
  thread_id,
  session_id: "s1",
  session_title: "title s1",
  anchor_text: `sentence of ${thread_id}`,
  flagged: true,
  first_question: null,
  unread: 0,
  last_message_at: at,
  ...extra,
});

// s1 holds an anchor tA with a tangent tB below it.
const s1 = { threads: [thread("tA"), thread("tB", "tA")], messages: [question("tA", "Why X?"), question("tB", "How Y?")] };

describe("pickUp", () => {
  it("is nothing when you have been nowhere and left nothing open", () => {
    expect(pickUp([summary("s1", null)], [], null, false)).toBeNull();
  });

  it("resumes the session you were in last, in the thread at the height you left it", () => {
    const sessions = [summary("s0", null), summary("s1", visit({ view: "thread", thread_id: "tB", anchor_key: "p0:s0", sheet: "full" }), 2)];
    expect(pickUp(sessions, [], s1, false)?.resume).toEqual({
      title: "title s1",
      parts: ["Article", "Why X?", "How Y?"],
      unread: true,
      view: { kind: "thread", session: "s1", thread: "tB", sheet: "full" },
    });
  });

  it("resumes on the article at the sentence you were at", () => {
    const sessions = [summary("s1", visit({ anchor_key: "p3:s1" }))];
    expect(pickUp(sessions, [], null, false)?.resume).toMatchObject({
      parts: ["Article"],
      unread: false,
      view: { kind: "article", session: "s1", at: "p3:s1" },
    });
  });

  it("resumes a thread that is gone on the article at its sentence", () => {
    const sessions = [summary("s1", visit({ view: "thread", thread_id: "gone", anchor_key: "p2:s0", sheet: "half" }))];
    expect(pickUp(sessions, [], s1, false)?.resume).toMatchObject({ parts: ["Article"], view: { kind: "article", session: "s1", at: "p2:s0" } });
  });

  it("names a loop by your first question, else its sentence, and opens it at half height", () => {
    const loops = [loop("tA", { first_question: "Why X?", unread: 1, flagged: false }), loop("tC")];
    expect(pickUp([], loops, null, false)?.loops).toEqual([
      { key: "tA", label: "Why X?", title: "title s1", unread: true, flagged: false, view: { kind: "thread", session: "s1", thread: "tA", sheet: "half" } },
      { key: "tC", label: "sentence of tC", title: "title s1", unread: false, flagged: true, view: { kind: "thread", session: "s1", thread: "tC", sheet: "half" } },
    ]);
  });

  it("leaves out the thread the resume line already opens", () => {
    const sessions = [summary("s1", visit({ view: "thread", thread_id: "tB", sheet: "half" }))];
    const shown = pickUp(sessions, [loop("tA"), loop("tB")], s1, false);
    expect(shown?.loops.map((l) => l.key)).toEqual(["tA"]);
    expect(shown?.total).toBe(1);
  });

  it(`shows ${LOOPS_SHOWN} loops, and all of them when asked`, () => {
    const loops = Array.from({ length: LOOPS_SHOWN + 2 }, (_, i) => loop(`t${i}`));
    expect(pickUp([], loops, null, false)).toMatchObject({ total: LOOPS_SHOWN + 2, loops: { length: LOOPS_SHOWN } });
    expect(pickUp([], loops, null, true)?.loops).toHaveLength(LOOPS_SHOWN + 2);
  });
});
