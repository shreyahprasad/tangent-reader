import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFound, Refused } from "./errors";
import { lastCacheCall, loops, promptFor, session, sessionSummaries, spending } from "./reads";
import type { NewCall, TangentDB } from "./schema";
import { addVisits, ask, createSession, failAnswer, finishAnswer, openAnchor, openTangent, retry, setFlag, streamAnswer } from "./store";
import { aCall, answeredThread, freshDB } from "./testing";

// The page's three reads, on a session built through the store at set times.

const ARTICLE = "Rivers carve canyons. Slowly.";
let db: TangentDB;
let ids: Record<"s1" | "s2" | "s3" | "anchor" | "tangent" | "quiet" | "q1" | "a1" | "q2", string>;

const at = (time: string) => vi.setSystemTime(new Date(`2026-10-05T${time}:00.000Z`));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  db = freshDB();
  at("10:00");
  const s1 = (await createSession(db, { text: ARTICLE, title: "Rivers" })).session_id;
  at("10:01");
  const anchor = (await openAnchor(db, s1, "p0:s0", "Rivers carve canyons.")).thread_id;
  at("10:02");
  const q1 = (await ask(db, anchor, "How?")).message_id;
  at("10:03");
  const call = aCall({ input_tokens: 100, output_tokens: 50, cache_write_tokens: 1000, cache_read_tokens: 0, cost_usd: 0.0032, request_json: '{"secret":"request body"}' });
  const a1 = (await finishAnswer(db, q1, { call, text: "Grit grinds. Floods help.", truncated: false, citations: [] })).message_id;
  at("10:04");
  const tangent = (await openTangent(db, a1, "p0:s1", "Floods help.")).thread_id;
  await setFlag(db, tangent, true);
  at("10:05");
  const q2 = (await ask(db, tangent, "Which floods?")).message_id;
  at("10:06");
  const quiet = (await openAnchor(db, s1, "p0:s1", "Slowly.")).thread_id;
  at("11:00");
  const s2 = (await createSession(db, { text: ARTICLE, title: "Again" })).session_id;
  at("12:10");
  const s3 = (await createSession(db, { text: ARTICLE, title: "Never opened" })).session_id;
  const opened = Array.from({ length: 32 }, (_, i) => ({
    at: `2026-10-05T12:${String(i + 1).padStart(2, "0")}:00.000Z`,
    view: "article" as const,
    thread_id: null,
    anchor_key: null,
    sheet: null,
    via: "open",
  }));
  await addVisits(db, s1, opened);
  await addVisits(db, s2, [{ at: "2026-10-05T11:30:00.000Z", view: "thread", thread_id: anchor, anchor_key: "p0:s0", sheet: "half", via: "resume" }]);
  ids = { s1, s2, s3, anchor, tangent, quiet, q1, a1, q2 };
});

afterEach(() => {
  db.close();
  vi.useRealTimers();
});

describe("session summaries", () => {
  it("carry their totals and the last place you were, most recently active first", async () => {
    const [s1, s3, s2] = await sessionSummaries(db);
    expect([s1.id, s3.id, s2.id]).toEqual([ids.s1, ids.s3, ids.s2]); // 12:32, then 12:10 with no visits, then 11:30
    expect(s1).toMatchObject({ threads: 3, questions: 2, unread: 1, pending: 1, flagged: 1, tokens: 1150, cost_usd: 0.0032 });
    expect(s1.last_visit).toEqual({ seq: 32, at: "2026-10-05T12:32:00.000Z", view: "article", thread_id: null, anchor_key: null, sheet: null, via: "open" });
    expect(s2).toMatchObject({ tokens: 0, cost_usd: 0, last_visit: { via: "resume" } });
    expect(s3.last_visit).toBeNull();
  });
});

describe("one session", () => {
  it("comes in full, with the trail newest first and no call log", async () => {
    const full = await session(db, ids.s1);
    expect(full.article).toBe(ARTICLE);
    expect([full.source, full.source_ref]).toEqual(["paste", null]);
    expect(full.threads.map((t) => t.id)).toEqual([ids.anchor, ids.tangent, ids.quiet]);
    expect(full.threads[1]).toMatchObject({ flagged: true, from_message_id: ids.a1 });
    const byId = new Map(full.messages.map((m) => [m.id, m]));
    expect(byId.get(ids.a1)).toMatchObject({ read_at: null, truncated: false });
    expect(byId.get(ids.q2)!.status).toBe("pending");
    expect(full.trail.map((v) => v.seq)).toEqual(Array.from({ length: 30 }, (_, i) => 32 - i));
    const sent = JSON.stringify(full);
    expect(sent).not.toContain("secret");
    expect(sent).not.toContain("request_json");
    expect(full.session).toMatchObject({ id: ids.s1, title: "Rivers", tokens: 1150 });
  });

  it("that is not saved says so", async () => {
    await expect(session(db, crypto.randomUUID())).rejects.toThrow(new NotFound("That session is not saved."));
  });
});

describe("loops", () => {
  it("are the threads you flagged or have answers you have not seen, labelled", async () => {
    const open = await loops(db);
    expect(open.map((l) => [l.thread_id, l.flagged, l.unread])).toEqual([
      [ids.tangent, true, 0], // its question at 10:05 is newer
      [ids.anchor, false, 1],
    ]);
    expect(open[1]).toMatchObject({ first_question: "How?", anchor_text: "Rivers carve canyons.", session_title: "Rivers", session_id: ids.s1 });
  });
});

describe("the prompt for a question", () => {
  it("carries the article, the path of tapped sentences from the anchor down, and the question", async () => {
    expect(await promptFor(db, ids.q2)).toMatchObject({
      session_id: ids.s1,
      thread_id: ids.tangent,
      article: ARTICLE,
      path: ["Rivers carve canyons.", "Floods help."],
      turns: [["user", "Which floods?"]],
    });
  });

  it("holds only answered turns: no failed question and no answer cut short", async () => {
    const { message_id: failed } = await ask(db, ids.anchor, "And wind?");
    await streamAnswer(db, failed, "Wind carries");
    await failAnswer(db, failed, { call: null, reason: "Could not reach Anthropic." });
    const { message_id: next } = await ask(db, ids.anchor, "And ice?");
    expect((await promptFor(db, next)).turns).toEqual([
      ["user", "How?"],
      ["assistant", "Grit grinds. Floods help."],
      ["user", "And ice?"],
    ]);
  });

  it("carries the question's Look it up switch, kept when it is asked again", async () => {
    const { message_id: q } = await ask(db, ids.quiet, "Why slowly?", true);
    expect((await promptFor(db, q)).search).toBe(true);
    await failAnswer(db, q, { call: null, reason: "Could not reach Anthropic." });
    await retry(db, q);
    expect((await promptFor(db, q)).search).toBe(true);
  });

  it("for a question asked again leaves out its own cut-short answer", async () => {
    const { message_id: q } = await ask(db, ids.quiet, "Why slowly?");
    await streamAnswer(db, q, "Because");
    await failAnswer(db, q, { call: null, reason: "Could not reach Anthropic." });
    await retry(db, q);
    expect((await promptFor(db, q)).turns).toEqual([["user", "Why slowly?"]]);
  });

  it("for an answer is refused", async () => {
    await expect(promptFor(db, ids.a1)).rejects.toThrow(NotFound);
  });

  it("for a question already answered is refused, so it is never asked twice", async () => {
    await expect(promptFor(db, ids.q1)).rejects.toThrow(new Refused("That question is no longer waiting for an answer."));
  });
});

describe("spending", () => {
  it("adds every call, and this month's apart, leaving out calls with no price", async () => {
    const other = freshDB();
    const { thread_id } = await answeredThread(other); // 0.0179 on 2026-10-12
    for (const [started_at, cost_usd] of [["2026-09-20T12:00:00.000Z", 0.5], ["2026-10-20T12:00:00.000Z", 0.25], ["2026-10-21T12:00:00.000Z", null]] as const) {
      const { message_id } = await ask(other, thread_id, "And then?");
      await failAnswer(other, message_id, { call: aCall({ started_at, cost_usd }), reason: "Anthropic is busy." });
    }
    expect(await spending(other, new Date("2026-10-25T12:00:00.000Z"))).toEqual({ total_usd: 0.7679, month_usd: 0.2679, calls: 4, unpriced: 1 });
    other.close();
  });

  it("is nothing on a new device", async () => {
    expect(await spending(freshDB())).toEqual({ total_usd: 0, month_usd: 0, calls: 0, unpriced: 0 });
  });
});

describe("the last call that touched an article's cache", () => {
  it("is the newest call on the article by that model that wrote or read the cache", async () => {
    const other = freshDB();
    const { session_id, thread_id } = await answeredThread(other); // claude-test, 2026-10-12T10:00
    const answerWith = async (call: Partial<NewCall>) => {
      const { message_id } = await ask(other, thread_id, "And then?");
      await failAnswer(other, message_id, { call: aCall(call), reason: "Anthropic is busy." });
    };
    await answerWith({ started_at: "2026-10-13T09:00:00.000Z", served_model: "claude-other" });
    await answerWith({ started_at: "2026-10-13T10:00:00.000Z", cache_write_tokens: 0, cache_read_tokens: 0 });
    expect(await lastCacheCall(other, session_id, "claude-test")).toBe("2026-10-12T10:00:00.000Z");
    expect(await lastCacheCall(other, session_id, "claude-other")).toBe("2026-10-13T09:00:00.000Z");
    expect(await lastCacheCall(other, session_id, "claude-none")).toBeNull();
    other.close();
  });
});
