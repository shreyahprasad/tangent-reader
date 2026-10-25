import { describe, expect, it } from "vitest";
import type { Message, Thread } from "./data";
import { outline, pillParts, threadLabel } from "./outline";

const thread = (id: string, key: string, parent: string | null = null, from: string | null = null, flagged = false): Thread => ({
  id,
  kind: parent ? "tangent" : "anchor",
  parent_thread_id: parent,
  from_message_id: from,
  anchor_key: key,
  anchor_text: `sentence of ${id}`,
  flagged,
  created_at: "2026-10-09T10:00:00.000Z",
});

const message = (id: string, threadId: string, seq: number, role: Message["role"], extra: Partial<Message> = {}): Message => ({
  id,
  thread_id: threadId,
  seq,
  role,
  text: `${role} ${id}`,
  status: "done",
  error: null,
  search: false,
  citations: [],
  call_id: role === "assistant" ? `call-${id}` : null,
  truncated: false,
  read_at: role === "assistant" ? "2026-10-09T10:01:00.000Z" : null,
  created_at: "2026-10-09T10:00:00.000Z",
  ...extra,
});

describe("threadLabel", () => {
  it("is your first question, or the anchored sentence before you ask", () => {
    const messages = [message("q1", "a", 1, "user"), message("r1", "a", 2, "assistant"), message("q2", "a", 3, "user")];
    expect(threadLabel({ messages }, thread("a", "p0:s0"))).toBe("user q1");
    expect(threadLabel({ messages }, thread("b", "p1:s0"))).toBe("sentence of b");
  });
});

describe("outline", () => {
  // Anchors made out of order; p10 must come after p2, not between p1 and p2.
  const threads = [
    thread("late", "p10:s0"),
    thread("first", "p1:s3"),
    thread("mid", "p2:s0"),
    thread("first-b", "p0:s1", "first", "r2"), // branched from the second answer
    thread("first-a", "p0:s0", "first", "r1"),
    thread("first-a-1", "p0:s0", "first-a", "r3"),
  ];
  const messages = [
    message("r1", "first", 2, "assistant", { read_at: null }),
    message("r2", "first", 4, "assistant"),
    message("r3", "first-a", 2, "assistant"),
    message("q", "mid", 1, "user", { status: "pending" }),
  ];
  const lines = outline({ threads, messages }, "first-a");

  it("lists the anchors in article order, each with its tangents below in the order they branched", () => {
    expect(lines.map((l) => [l.thread.id, l.depth])).toEqual([
      ["first", 0],
      ["first-a", 1],
      ["first-a-1", 2],
      ["first-b", 1],
      ["mid", 0],
      ["late", 0],
    ]);
  });

  it("draws the tree: a line for each level above that has more below, and whether this is the last", () => {
    const tree = (id: string) => {
      const l = lines.find((l) => l.thread.id === id)!;
      return [l.guides, l.last];
    };
    expect(tree("first")).toEqual([[], false]);
    expect(tree("first-a")).toEqual([[true], false]); // "first" has more anchors after it
    expect(tree("first-a-1")).toEqual([[true, true], true]); // "first-a" has "first-b" after it
    expect(tree("first-b")).toEqual([[true], true]);
    expect(tree("late")).toEqual([[], true]);
  });

  it("marks the path from the article down to where you are", () => {
    expect(lines.filter((l) => l.onPath).map((l) => l.thread.id)).toEqual(["first", "first-a"]);
  });

  it("marks where you are, and each thread's own unread, waiting and flagged", () => {
    const byId = new Map(lines.map((l) => [l.thread.id, l]));
    expect(byId.get("first-a")!.here).toBe(true);
    expect(lines.filter((l) => l.here)).toHaveLength(1);
    expect(byId.get("first")!.unread).toBe(true);
    expect(byId.get("first-a")!.unread).toBe(false); // its own, not gathered from below
    expect(byId.get("mid")!.waiting).toBe(true);
    expect(outline({ threads: [thread("f", "p0:s0", null, null, true)], messages: [] }, null)[0].flagged).toBe(true);
  });
});

describe("pillParts", () => {
  it("shows the whole path while it is short", () => {
    expect(pillParts(["Why X"])).toEqual(["Article", "Why X"]);
    expect(pillParts(["Why X", "How Y"])).toEqual(["Article", "Why X", "How Y"]);
  });

  it("folds the middle of a long path, keeping where you are", () => {
    expect(pillParts(["Why X", "How Y", "And Z"])).toEqual(["Article", "…", "And Z"]);
  });
});
