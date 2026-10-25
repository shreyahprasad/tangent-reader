import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VISIT_BATCH, VISIT_FLUSH_MS, VISITS_PER_BATCH } from "./style";
import { visitFor, VisitQueue, type NewVisit } from "./visits";

const NOW = new Date("2026-10-09T10:00:00.000Z");

describe("visitFor", () => {
  it("writes an article visit with the sentence it is at, and no thread or sheet", () => {
    expect(visitFor({ kind: "article", session: "s1", at: "p2:s0" }, null, "start", NOW)).toEqual({
      at: "2026-10-09T10:00:00.000Z",
      view: "article",
      thread_id: null,
      anchor_key: "p2:s0",
      sheet: null,
      via: "start",
    });
  });

  it("writes a thread visit with its height and the article sentence its anchor sits on", () => {
    expect(visitFor({ kind: "thread", session: "s1", thread: "t9", sheet: "full" }, "p4:s1", "dot", NOW)).toMatchObject({
      view: "thread",
      thread_id: "t9",
      anchor_key: "p4:s1",
      sheet: "full",
    });
  });
});

describe("VisitQueue", () => {
  const visit = (n: number): NewVisit => ({ at: NOW.toISOString(), view: "article", thread_id: null, anchor_key: `p${n}:s0`, sheet: null, via: "back" });
  let post: ReturnType<typeof vi.fn<(batch: NewVisit[]) => Promise<unknown>>>;
  let queue: VisitQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    post = vi.fn(async () => ({}));
    queue = new VisitQueue(post);
  });
  /** Sent and taken: nothing is left to send. */
  const nothingLeft = () => {
    const calls = post.mock.calls.length;
    queue.flush(true);
    expect(post.mock.calls.length).toBe(calls);
  };
  afterEach(() => vi.useRealTimers());

  it("holds visits until VISIT_FLUSH_MS has passed, then sends them together", async () => {
    queue.add(visit(1));
    queue.add(visit(2));
    expect(post).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(VISIT_FLUSH_MS);
    expect(post).toHaveBeenCalledExactlyOnceWith([visit(1), visit(2)]);
    nothingLeft();
  });

  it("sends at once when VISIT_BATCH are waiting", async () => {
    for (let n = 0; n < VISIT_BATCH; n++) queue.add(visit(n));
    await vi.advanceTimersByTimeAsync(0);
    expect(post).toHaveBeenCalledOnce();
  });

  it("keeps a batch the store did not take, and sends it with the next", async () => {
    post.mockRejectedValueOnce(new Error("offline"));
    queue.add(visit(1));
    await vi.advanceTimersByTimeAsync(VISIT_FLUSH_MS);
    queue.add(visit(2));
    await vi.advanceTimersByTimeAsync(VISIT_FLUSH_MS);
    expect(post).toHaveBeenLastCalledWith([visit(1), visit(2)]);
    nothingLeft();
  });

  it("as the page hides, sends what is left at once, past one already on its way", async () => {
    let arrive = () => {};
    post.mockReturnValueOnce(new Promise<void>((resolve) => (arrive = resolve)));
    for (let n = 0; n < VISIT_BATCH; n++) queue.add(visit(n));
    queue.add(visit(99));
    queue.flush(true);
    expect(post).toHaveBeenLastCalledWith([visit(99)]);
    arrive();
    await vi.advanceTimersByTimeAsync(0);
    nothingLeft();
  });

  it("never sends more than the store takes at once", async () => {
    for (let n = 0; n < VISIT_BATCH + VISITS_PER_BATCH + 1; n++) queue.add(visit(n));
    queue.flush(true);
    expect(post.mock.calls.map(([batch]) => batch.length)).toEqual([VISIT_BATCH, VISITS_PER_BATCH, 1]);
  });
});
