import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFound, Refused, Rejected } from "./errors";
import { INTERRUPTED } from "./rules";
import type { TangentDB } from "./schema";
import {
  addVisits,
  ask,
  callLock,
  createSession,
  dropReply,
  failAnswer,
  finishAnswer,
  markRead,
  openAnchor,
  openStore,
  openTangent,
  retry,
  setFlag,
  streamAnswer,
  undoThread,
} from "./store";
import { aCall, ANSWER, ARTICLE, answeredThread, FIRST, freshDB, messagesIn } from "./testing";
import { DOC_TOKENS, VISITS_PER_BATCH } from "../tangent/style";

let db: TangentDB;
beforeEach(() => {
  db = freshDB();
});
afterEach(() => db.close());

const inThread = (threadId: string) => messagesIn(db, threadId);

async function waiting() {
  const { session_id } = await createSession(db, { text: ARTICLE });
  const { thread_id } = await openAnchor(db, session_id, "p0:s0", FIRST);
  const { message_id } = await ask(db, thread_id, "Why so slow?");
  return { session_id, thread_id, question_id: message_id };
}

// ── Sessions ─────────────────────────────────────────────────────────────────

describe("a new session", () => {
  it("is titled by the article's first sentence, and the article is stored once under its sha-256", async () => {
    const first = await createSession(db, { text: ARTICLE });
    const second = await createSession(db, { text: ARTICLE, title: " Again " });
    const titles = (await db.sessions.orderBy("id").toArray()).map((s) => [s.id, s.title]);
    expect(Object.fromEntries(titles)).toEqual({ [first.session_id]: FIRST, [second.session_id]: "Again" });
    expect(await db.articles.count()).toBe(1);
    expect(first.article_id).toBe("1d00573f6495976b85043b80a24125a6313a6eb873e69bf3c0ca875a3a04068f"); // shasum -a 256 of ARTICLE
  });

  it("keeps where the article came from", async () => {
    const { article_id } = await createSession(db, { text: ARTICLE, source: "url", source_ref: "https://example.com/rivers" });
    expect(await db.articles.get(article_id)).toMatchObject({ source: "url", source_ref: "https://example.com/rivers", title: FIRST });
    await expect(createSession(db, { text: "Other text.", source: "file", source_ref: null })).rejects.toThrow(Rejected);
  });

  it("refuses an empty article and saves nothing", async () => {
    await expect(createSession(db, { text: "   \n " })).rejects.toThrow(new Rejected("Add something to read first."));
    expect(await db.sessions.count()).toBe(0);
  });

  it("refuses a document over the size limit and saves nothing, whatever form let it through", async () => {
    const huge = "word ".repeat(DOC_TOKENS); // about 1.6 tokens a word
    await expect(createSession(db, { text: huge, source: "file", source_ref: "huge.txt" })).rejects.toThrow(/^That is about [\d,]+ tokens\. Tangent reads up to 50,000 at a time\./);
    expect(await db.articles.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
  });
});

// ── Threads ──────────────────────────────────────────────────────────────────

describe("threads", () => {
  it("reopen when you tap the same sentence again", async () => {
    const { session_id } = await createSession(db, { text: ARTICLE });
    const first = await openAnchor(db, session_id, "p0:s0", FIRST);
    expect(first.created).toBe(true);
    expect(await openAnchor(db, session_id, "p0:s0", FIRST)).toEqual({ thread_id: first.thread_id, created: false });
    expect(await db.threads.count()).toBe(1);
  });

  it("anchor only on a sentence of the article, at a real position, in a saved session", async () => {
    const { session_id } = await createSession(db, { text: ARTICLE });
    await expect(openAnchor(db, session_id, "p0:s0", "Not there.")).rejects.toThrow(new Rejected("That sentence is not in the article."));
    await expect(openAnchor(db, session_id, "3:2", FIRST)).rejects.toThrow(Rejected);
    await expect(openAnchor(db, crypto.randomUUID(), "p0:s0", FIRST)).rejects.toThrow(NotFound);
  });

  it("branch a tangent from a sentence of an answer into a child thread (rule 1)", async () => {
    const { session_id, thread_id, answer_id } = await answeredThread(db);
    const tangent = await openTangent(db, answer_id, "p0:s1", "Floods do most of the work.");
    expect(await openTangent(db, answer_id, "p0:s1", "Floods do most of the work.")).toEqual({ thread_id: tangent.thread_id, created: false });
    expect(await db.threads.get(tangent.thread_id)).toMatchObject({
      kind: "tangent",
      session_id,
      parent_thread_id: thread_id,
      from_message_id: answer_id,
    });
  });

  it("cannot branch from a question, or from a sentence not in the answer", async () => {
    const { question_id, answer_id } = await answeredThread(db);
    await expect(openTangent(db, question_id, "p0:s0", "Why so slow?")).rejects.toThrow(Rejected);
    await expect(openTangent(db, answer_id, "p0:s0", FIRST)).rejects.toThrow(new Rejected("That sentence is not in the answer."));
  });

  it("can be undone only while empty (rule 3)", async () => {
    const { session_id } = await createSession(db, { text: ARTICLE });
    const empty = await openAnchor(db, session_id, "p1:s1", "It is still cutting.");
    await undoThread(db, empty.thread_id);
    const { thread_id } = await answeredThread(db);
    await expect(undoThread(db, thread_id)).rejects.toThrow(new Refused("This thread has a conversation in it, so it stays."));
    expect((await db.threads.toArray()).map((t) => t.id)).toEqual([thread_id]);
  });

  it("flag, and mark their answers read once", async () => {
    const { thread_id, answer_id } = await answeredThread(db);
    await setFlag(db, thread_id, true);
    expect((await db.threads.get(thread_id))!.flagged).toBe(true);
    expect(await markRead(db, thread_id)).toBe(1);
    expect(await markRead(db, thread_id)).toBe(0);
    expect((await db.messages.get(answer_id))!.read_at).not.toBeNull();
  });
});

// ── Asking ───────────────────────────────────────────────────────────────────

describe("a question", () => {
  it("waits, then gets its answer, with the call saved in full and tied to where it was asked", async () => {
    const { session_id, thread_id, question_id } = await waiting();
    expect((await inThread(thread_id)).map((m) => [m.role, m.status])).toEqual([["user", "pending"]]);
    const { message_id, call_id } = await finishAnswer(db, question_id, { call: aCall(), text: ANSWER, truncated: false, citations: [] });
    const [question, answer] = await inThread(thread_id);
    expect(question.status).toBe("done");
    expect(answer).toMatchObject({ id: message_id, role: "assistant", text: ANSWER, status: "done", call_id, read_at: null, seq: 2 });
    const call = (await db.calls.get(call_id))!;
    const { article_id } = (await db.sessions.get(session_id))!;
    expect(call).toMatchObject({ ...aCall(), session_id, thread_id, asked_message_id: question_id, article_id });
  });

  it("keeps its request exactly as given (rule 5)", async () => {
    const { question_id } = await waiting();
    const request_json = '{"b": 1,  "a":"\\u00e9 é",\n"z":[ ]}';
    const { call_id } = await finishAnswer(db, question_id, { call: aCall({ request_json }), text: ANSWER, truncated: false, citations: [] });
    expect((await db.calls.get(call_id))!.request_json).toBe(request_json);
  });

  it("refuses a call carrying headers, so your key can never reach the log", async () => {
    const { question_id } = await waiting();
    const request_json = JSON.stringify({ headers: { "x-api-key": "sk-ant-made-up" }, body: {} });
    await expect(finishAnswer(db, question_id, { call: aCall({ request_json }), text: ANSWER, truncated: false, citations: [] })).rejects.toThrow(Rejected);
    expect(await db.calls.count()).toBe(0);
  });

  it("saves its reply as it arrives, in one answer that stays streaming until done", async () => {
    const { thread_id, question_id } = await waiting();
    const first = await streamAnswer(db, question_id, "Water carries");
    const again = await streamAnswer(db, question_id, "Water carries grit");
    expect(again.message_id).toBe(first.message_id);
    expect((await inThread(thread_id)).map((m) => [m.status, m.text])).toEqual([
      ["pending", "Why so slow?"],
      ["streaming", "Water carries grit"],
    ]);
    const done = await finishAnswer(db, question_id, { call: aCall(), text: ANSWER, truncated: false, citations: [{ url: "https://example.com", title: "Rivers" }] });
    expect(done.message_id).toBe(first.message_id);
    expect((await db.messages.get(first.message_id))).toMatchObject({ status: "done", text: ANSWER, citations: [{ url: "https://example.com", title: "Rivers" }] });
  });

  it("drops a reply that started before a search, and the question keeps waiting", async () => {
    const { thread_id, question_id } = await waiting();
    await dropReply(db, question_id); // nothing arrived yet: nothing to drop
    await streamAnswer(db, question_id, "Let me look that up.");
    await dropReply(db, question_id);
    expect((await inThread(thread_id)).map((m) => [m.role, m.status])).toEqual([["user", "pending"]]);
    await streamAnswer(db, question_id, "Water carries");
    expect((await inThread(thread_id)).map((m) => m.text)).toEqual(["Why so slow?", "Water carries"]);
  });

  it("is one at a time per thread, while its reply arrives too (rule 4)", async () => {
    const { thread_id, question_id } = await waiting();
    const busy = new Refused("Claude is still answering your last question here. Wait for it, then ask.");
    await expect(ask(db, thread_id, "Another?")).rejects.toThrow(busy);
    await streamAnswer(db, question_id, "Water");
    await expect(ask(db, thread_id, "Another?")).rejects.toThrow(busy);
    expect(await db.messages.count()).toBe(2);
  });

  it("that failed is saved with its call and says why", async () => {
    const { thread_id, question_id } = await waiting();
    const call = aCall({ status: "error", error_kind: "rate_limited", http_status: 429, cost_usd: null });
    const { call_id } = await failAnswer(db, question_id, { call, reason: "Anthropic is busy. Wait a minute, then ask again." });
    expect(await inThread(thread_id)).toMatchObject([{ status: "failed", error: "Anthropic is busy. Wait a minute, then ask again." }]);
    expect((await db.calls.get(call_id!))!.error_kind).toBe("rate_limited");
  });

  it("that failed partway keeps what arrived, marked interrupted, and one with no call saves none", async () => {
    const { thread_id, question_id } = await waiting();
    await streamAnswer(db, question_id, "Water carries");
    const call = aCall({ status: "error", error_kind: "unreachable", http_status: null });
    const { call_id } = await failAnswer(db, question_id, { call, reason: "Anthropic could not be reached." });
    expect(await inThread(thread_id)).toMatchObject([{ status: "failed" }, { status: "interrupted", text: "Water carries", call_id }]);

    const other = await waiting();
    expect(await failAnswer(db, other.question_id, { call: null, reason: "Add your key first." })).toEqual({ call_id: null });
    expect(await db.calls.count()).toBe(1);
  });

  it("keeps an answer cut off at its length, marked", async () => {
    const { question_id } = await waiting();
    const { message_id } = await finishAnswer(db, question_id, { call: aCall({ stop_reason: "max_tokens" }), text: ANSWER, truncated: true, citations: [] });
    expect((await db.messages.get(message_id))!.truncated).toBe(true);
  });

  it("can be asked again once it failed, and the failed call stays", async () => {
    const { thread_id, question_id } = await waiting();
    await failAnswer(db, question_id, { call: aCall({ status: "error", error_kind: "rate_limited" }), reason: "Busy." });
    await retry(db, question_id);
    expect((await db.messages.get(question_id))).toMatchObject({ status: "pending", error: null });
    await finishAnswer(db, question_id, { call: aCall(), text: ANSWER, truncated: false, citations: [] });
    expect((await inThread(thread_id)).map((m) => m.status)).toEqual(["done", "done"]);
    expect((await db.calls.toArray()).map((c) => c.status).sort()).toEqual(["error", "ok"]);
    await expect(retry(db, question_id)).rejects.toThrow(new Refused("Only a question that failed or was cut short can be asked again."));
  });

  it("no longer waiting takes no reply, and an empty question or answer is refused", async () => {
    const { thread_id, question_id } = await waiting();
    await expect(finishAnswer(db, question_id, { call: aCall(), text: " ", truncated: false, citations: [] })).rejects.toThrow(Rejected);
    await finishAnswer(db, question_id, { call: aCall(), text: ANSWER, truncated: false, citations: [] });
    await expect(streamAnswer(db, question_id, "More")).rejects.toThrow(Refused);
    await expect(ask(db, thread_id, "  ")).rejects.toThrow(new Rejected("Write a question first."));
  });
});

// ── Rule 6 and rule 8 ────────────────────────────────────────────────────────

it("a write that fails partway leaves no trace (rule 6)", async () => {
  const { thread_id, question_id } = await waiting();
  vi.spyOn(db.messages, "update").mockRejectedValueOnce(new Error("disk full"));
  await expect(finishAnswer(db, question_id, { call: aCall(), text: ANSWER, truncated: false, citations: [] })).rejects.toThrow("disk full");
  expect(await db.calls.count()).toBe(0);
  expect(await inThread(thread_id)).toMatchObject([{ status: "pending" }]);
});

it("opening the store leaves alone a question another tab is still asking (rule 8)", async () => {
  const asked = await waiting();
  await streamAnswer(db, asked.question_id, "Water carries");
  const gone = await waiting();
  let release!: () => void;
  const held = new Promise<void>((r) => (release = r));
  const lock = navigator.locks.request(callLock(asked.question_id), () => held);
  expect(await openStore(db)).toBe(1);
  expect((await inThread(asked.thread_id)).map((m) => m.status)).toEqual(["pending", "streaming"]);
  expect(await inThread(gone.thread_id)).toMatchObject([{ status: "interrupted" }]);
  release();
  await lock;
});

it("opening the store marks what a closed tab left in flight as interrupted, and keeps its text (rule 8)", async () => {
  const left = await waiting();
  await streamAnswer(db, left.question_id, "Water carries");
  const done = await answeredThread(db);
  const cut = await waiting();
  expect(await openStore(db)).toBe(3);
  expect(await inThread(left.thread_id)).toMatchObject([
    { status: "interrupted", error: INTERRUPTED },
    { status: "interrupted", text: "Water carries" },
  ]);
  expect(await inThread(cut.thread_id)).toMatchObject([{ status: "interrupted" }]);
  expect((await inThread(done.thread_id)).map((m) => m.status)).toEqual(["done", "done"]);

  await retry(db, left.question_id);
  await finishAnswer(db, left.question_id, { call: aCall(), text: ANSWER, truncated: false, citations: [] });
  expect((await inThread(left.thread_id)).map((m) => [m.seq, m.status])).toEqual([
    [1, "done"],
    [2, "interrupted"],
    [3, "done"],
  ]);
});

// ── Visits ───────────────────────────────────────────────────────────────────

const visit = (extra: Record<string, unknown> = {}) => ({
  at: "2026-10-05T18:00:00.000Z",
  view: "article" as const,
  thread_id: null,
  anchor_key: null,
  sheet: null,
  via: "open",
  ...extra,
});

describe("visits", () => {
  it("append in order across batches, in UTC, and keep a visit to a thread later undone", async () => {
    const { session_id } = await createSession(db, { text: ARTICLE });
    const { thread_id } = await openAnchor(db, session_id, "p0:s0", FIRST);
    const there = visit({ view: "thread", thread_id, sheet: "half", via: "sentence", at: "2026-10-05T14:00:01-04:00" });
    expect(await addVisits(db, session_id, [visit(), there])).toBe(2);
    await undoThread(db, thread_id);
    await addVisits(db, session_id, [visit({ via: "back", anchor_key: "p0:s0" })]);
    const saved = await db.visits.toArray();
    expect(saved.map((v) => [v.seq, v.via])).toEqual([
      [1, "open"],
      [2, "sentence"],
      [3, "back"],
    ]);
    expect(saved[1]).toMatchObject({ thread_id, at: "2026-10-05T18:00:01.000Z" });
  });

  it.each([
    ["a thread visit with no sheet", [visit({ view: "thread", thread_id: crypto.randomUUID() })]],
    ["an article visit with a sheet", [visit({ sheet: "half" })]],
    ["a time with no zone", [visit({ at: "2026-10-05T18:00:00" })]],
    ["an unknown way there", [visit({ via: "teleport" })]],
    ["no visits", []],
    ["too many at once", Array.from({ length: VISITS_PER_BATCH + 1 }, () => visit())],
  ])("refuse %s and save none", async (_, visits) => {
    const { session_id } = await createSession(db, { text: ARTICLE });
    await expect(addVisits(db, session_id, visits as never)).rejects.toThrow(Rejected);
    expect(await db.visits.count()).toBe(0);
  });

  it("need a saved session", async () => {
    await expect(addVisits(db, crypto.randomUUID(), [visit()])).rejects.toThrow(NotFound);
  });
});
