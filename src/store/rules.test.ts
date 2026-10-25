import { beforeAll, describe, expect, it } from "vitest";
import type { Message } from "../tangent/data";
import { fileProblem, INTERRUPTED, interrupted, pick, rowProblem } from "./rules";
import type { Rows } from "./schema";
import { addVisits, articleId, ask, openTangent } from "./store";
import { aCall, answeredThread, freshDB } from "./testing";

// The whole-file check an import runs, on rows made through the store and then broken one way
// at a time.

let good: Rows;

/** What an import works out before checking: the sha-256 of each article's text, by its id. */
const hashesOf = async (rows: Rows) => new Map(await Promise.all(rows.articles.map(async (a) => [a.id, await articleId(a.text)] as const)));

beforeAll(async () => {
  const db = freshDB();
  const { session_id, answer_id } = await answeredThread(db);
  const { thread_id } = await openTangent(db, answer_id, "p0:s1", "Floods do most of the work.");
  await ask(db, thread_id, "Which floods?");
  await addVisits(db, session_id, [{ at: "2026-10-05T18:00:00.000Z", view: "thread", thread_id, anchor_key: "p0:s0", sheet: "half", via: "branch" }]);
  good = {
    articles: await db.articles.toArray(),
    sessions: await db.sessions.toArray(),
    threads: await db.threads.toCollection().sortBy("created_at"),
    messages: await db.messages.orderBy("[thread_id+seq]").toArray(),
    calls: await db.calls.toArray(),
    visits: await db.visits.toArray(),
  };
  db.close();
});

async function broken(change: (rows: Rows) => void) {
  const rows = structuredClone(good);
  change(rows);
  return fileProblem(rows, await hashesOf(rows));
}
const anchor = (rows: Rows) => rows.threads.find((t) => t.kind === "anchor")!;
const tangent = (rows: Rows) => rows.threads.find((t) => t.kind === "tangent")!;
const question = (rows: Rows) => rows.messages.find((m) => m.role === "user" && m.thread_id === anchor(rows).id)!;
const waiting = (rows: Rows) => rows.messages.find((m) => m.status === "pending")!;
const answer = (rows: Rows) => rows.messages.find((m) => m.role === "assistant")!;

describe("a file", () => {
  it("made by the store passes", async () => {
    expect(fileProblem(good, await hashesOf(good))).toBeNull();
  });

  it.each<[string, (rows: Rows) => void, string]>([
    ["a field it does not know", (r) => Object.assign(r.sessions[0], { note: "x" }), "sessions row 1: note is not a field"],
    ["a field missing", (r) => delete (r.calls[0] as Partial<Rows["calls"][number]>).latency_ms, "calls row 1: latency_ms is missing"],
    ["a value out of range", (r) => Object.assign(r.messages[0], { role: "system" }), "messages row 1: role is not valid"],
    ["a time with no zone", (r) => Object.assign(r.visits[0], { at: "2026-10-05T18:00:00" }), "visits row 1: at is not valid"],
    ["an article changed after it was saved", (r) => (r.articles[0].text += " More."), "does not match its text"],
    ["a session with no article", (r) => (r.articles = []), "has no article"],
    ["an id twice", (r) => r.sessions.push({ ...r.sessions[0] }), "twice"],
    ["two messages in one place", (r) => (answer(r).seq = question(r).seq), "taken twice"],
    ["an anchor with a parent (rule 1)", (r) => (anchor(r).parent_thread_id = tangent(r).id), "an anchor has no parent"],
    ["a tangent from a question (rule 1)", (r) => (tangent(r).from_message_id = question(r).id), "does not branch from an answer in its parent"],
    ["a tangent from another thread's answer (rule 1)", (r) => (tangent(r).parent_thread_id = tangent(r).id), "does not branch from an answer in its parent"],
    ["a sentence not in its article", (r) => (anchor(r).anchor_text = "Not there."), "not in the article"],
    ["a thread above itself (rule 2)", cycle, "is its own ancestor"],
    ["two questions waiting in a thread (rule 4)", (r) => r.messages.push({ ...waiting(r), id: crypto.randomUUID(), seq: 2 }), "two questions waiting"],
    ["a question streaming", (r) => Object.assign(question(r), { status: "streaming" }), "a question cannot be streaming"],
    ["a finished answer with no call", (r) => (answer(r).call_id = null), "a finished answer has its call"],
    ["a message whose call is missing", (r) => (r.calls = []), "has no call"],
    ["a call that holds headers", (r) => (r.calls[0].request_json = JSON.stringify({ headers: { "x-api-key": "sk-ant-made-up" } })), "carries headers"],
    ["a call for an answer, not a question", (r) => (r.calls[0].asked_message_id = answer(r).id), "has no question in its thread"],
    ["a visit with no session", (r) => (r.visits[0].session_id = crypto.randomUUID()), "a visit has no session"],
    ["a link that is not a web address", (r) => Object.assign(r.articles[0], { source: "url", source_ref: "javascript:alert(1)" }), "a link is a web address"],
  ])("with %s is refused", async (_, change, says) => {
    expect(await broken(change)).toContain(says);
  });
});

/** Two tangents, each the other's parent, each from an answer in the other. */
function cycle(rows: Rows) {
  const a = tangent(rows);
  const b = { ...a, id: crypto.randomUUID(), anchor_key: "p0:s0", anchor_text: "Water carries grit that grinds the rock." };
  const inA = { ...answer(rows), id: crypto.randomUUID(), thread_id: a.id, seq: 9 };
  const inB = { ...answer(rows), id: crypto.randomUUID(), thread_id: b.id, seq: 1 };
  Object.assign(a, { parent_thread_id: b.id, from_message_id: inB.id });
  Object.assign(b, { parent_thread_id: a.id, from_message_id: inA.id });
  rows.threads.push(b);
  rows.messages.push(inA, inB);
}

describe("rows", () => {
  it("are picked down to their fields, so nothing else leaves in an export", () => {
    const row = { ...good.sessions[0], key: "sk-ant-made-up" };
    expect(pick("sessions", row)).toEqual(good.sessions[0]);
  });

  it("of an article keep a link only to a web address, which the page will draw as a link", () => {
    const article = { ...good.articles[0], source: "url" as const };
    expect(rowProblem("articles", { ...article, source_ref: "https://example.com/rivers" })).toBeNull();
    for (const ref of ["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd", "not a link"]) {
      expect(rowProblem("articles", { ...article, source_ref: ref }), ref).toBe("a link is a web address (http or https)");
    }
    expect(rowProblem("articles", { ...article, source: "file", source_ref: "notes.pdf" })).toBeNull();
  });

  it("of a call are refused when ok has an error kind or the request is not JSON", () => {
    const call = { ...aCall(), id: crypto.randomUUID(), session_id: crypto.randomUUID(), thread_id: crypto.randomUUID(), asked_message_id: crypto.randomUUID(), article_id: "a".repeat(64) };
    expect(rowProblem("calls", call)).toBeNull();
    expect(rowProblem("calls", { ...call, error_kind: "auth" })).toBe("only a failed call has an error kind");
    expect(rowProblem("calls", { ...call, request_json: "{" })).toBe("its request is not JSON");
  });
});

describe("rule 8", () => {
  const m = (extra: Partial<Message>): Message => ({ ...good.messages[0], ...extra });

  it("marks a question still pending and an answer still streaming as interrupted, and nothing else", () => {
    expect(interrupted(m({ role: "user", status: "pending" }))).toMatchObject({ status: "interrupted", error: INTERRUPTED });
    expect(interrupted(m({ role: "assistant", status: "streaming", text: "Half" }))).toMatchObject({ status: "interrupted", text: "Half", error: null });
    expect(interrupted(m({ role: "user", status: "done" }))).toBeNull();
  });
});
