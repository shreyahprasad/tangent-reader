import Dexie from "dexie";
import { nowISO } from "../shell/dates";
import type { Citation, Message, Source } from "../tangent/data";
import { VISITS_PER_BATCH } from "../tangent/style";
import { defaultTitle, normalizeArticle, sizeStatus } from "../tangent/tangent";
import type { NewVisit } from "../tangent/visits";
import { NotFound, Outdated, Refused, Rejected } from "./errors";
import { ANCHOR_KEY, interrupted, rowProblem } from "./rules";
import type { Call, NewCall, TableName, TangentDB, ThreadRow, VisitRow } from "./schema";

// Every change to your reading (docs/design.md, Data). Each write that touches more than one
// table is one readwrite transaction (rule 6). IndexedDB runs overlapping readwrite transactions
// one at a time, even across tabs, so a check and the write it guards cannot be split. Every row
// is checked against rules.ts before it is written.

const newId = () => crypto.randomUUID();

/** The sha-256 of an article's text, which is its id. */
export async function articleId(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function checked<T extends TableName>(table: T, row: object) {
  const problem = rowProblem(table, row);
  if (problem) throw new Rejected(`That could not be saved: ${problem}.`);
  return row as never;
}

async function one<T>(found: Promise<T | undefined>, missing: string): Promise<T> {
  const row = await found;
  if (row === undefined) throw new NotFound(missing);
  return row;
}

const RELOAD = "Reload the page.";
const thread = (db: TangentDB, id: string) => one(db.threads.get(id), `That thread is not saved. ${RELOAD}`);
const message = (db: TangentDB, id: string) => one(db.messages.get(id), `That message is not saved. ${RELOAD}`);
const touch = (db: TangentDB, sessionId: string, at = nowISO()) => db.sessions.update(sessionId, { updated_at: at });

async function nextSeq(db: TangentDB, threadId: string): Promise<number> {
  const last = await db.messages.where("[thread_id+seq]").between([threadId, Dexie.minKey], [threadId, Dexie.maxKey]).last();
  return (last?.seq ?? 0) + 1;
}

const inThread = (db: TangentDB, threadId: string, test: (m: Message) => boolean) =>
  db.messages.where("thread_id").equals(threadId).filter(test).first();

// ── Opening ──────────────────────────────────────────────────────────────────

const CALL_LOCK = "tangent-call:";

/** The Web Lock a tab holds while it asks Claude this question, released when the answer is saved
 *  or the tab closes. */
export const callLock = (questionId: string) => CALL_LOCK + questionId;

/** Web Locks, which a browser offers only to a secure page (https, or localhost). Without them a
 *  question is asked unguarded, as if in one tab. */
export const lockManager = (): LockManager | undefined => globalThis.navigator?.locks;

/** Questions another tab is asking Claude right now. */
async function inFlight(): Promise<Set<string>> {
  const locks = lockManager();
  if (!locks) return new Set();
  const { held = [] } = await locks.query();
  return new Set(held.flatMap((l) => (l.name?.startsWith(CALL_LOCK) ? [l.name.slice(CALL_LOCK.length)] : [])));
}

/** Opens the database and applies rule 8: a question still pending or an answer still streaming
 *  means the tab closed mid-call. A question whose call lock is held is still being asked in
 *  another tab, so it and its arriving answer are left alone. Returns how many it marked. Refuses a
 *  database a newer page has already moved past this code's version. */
export async function openStore(db: TangentDB): Promise<number> {
  await db.open();
  if (db.installed() > db.known) {
    db.close({ disableAutoOpen: true });
    throw new Outdated();
  }
  const asking = await inFlight(); // before the transaction: a wait outside IndexedDB would end it
  return db.transaction("rw", db.messages, async () => {
    const left = await db.messages.where("status").anyOf("pending", "streaming").toArray();
    const busy = new Set(left.filter((m) => asking.has(m.id)).map((m) => m.thread_id));
    const marked = left.filter((m) => !busy.has(m.thread_id)).flatMap((m) => interrupted(m) ?? []);
    await db.messages.bulkPut(marked);
    return marked.length;
  });
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export interface NewSession {
  text: string;
  /** Blank means the article's first sentence. */
  title?: string;
  source?: Source;
  /** The link or the file name. Null for a paste. */
  source_ref?: string | null;
}

/** A session on this article. The article is stored once, however often you bring it. */
export async function createSession(db: TangentDB, { text, title, source = "paste", source_ref = null }: NewSession) {
  const article = normalizeArticle(text);
  if (!article) throw new Rejected("Add something to read first.");
  const size = sizeStatus(article, source);
  if (size.over) throw new Rejected(size.note!); // the form refuses first; this keeps any other way in honest
  const article_id = await articleId(article); // before the transaction: a wait outside IndexedDB would end it
  const at = nowISO();
  const session_id = newId();
  const named = title?.trim() || defaultTitle(article);
  await db.transaction("rw", db.articles, db.sessions, async () => {
    if (!(await db.articles.get(article_id))) {
      await db.articles.add(checked("articles", { id: article_id, text: article, title: named, created_at: at, source, source_ref }));
    }
    await db.sessions.add(checked("sessions", { id: session_id, article_id, title: named, created_at: at, updated_at: at }));
  });
  return { session_id, article_id };
}

// ── Threads ──────────────────────────────────────────────────────────────────

function checkAnchor(anchorKey: string, anchorText: string) {
  if (!ANCHOR_KEY.test(anchorKey)) throw new Rejected("That sentence's place is not one the page makes.");
  if (!anchorText.trim()) throw new Rejected("Tap a sentence first.");
}

async function insertThread(db: TangentDB, fields: Omit<ThreadRow, "id" | "flagged" | "created_at">) {
  const at = nowISO();
  const id = newId();
  await db.threads.add(checked("threads", { id, ...fields, flagged: false, created_at: at }));
  await touch(db, fields.session_id, at);
  return { thread_id: id, created: true };
}

/** The thread on this article sentence: the one already there, or a new one. */
export async function openAnchor(db: TangentDB, sessionId: string, anchorKey: string, anchorText: string) {
  checkAnchor(anchorKey, anchorText);
  return db.transaction("rw", db.sessions, db.articles, db.threads, async () => {
    const session = await one(db.sessions.get(sessionId), `That session is not saved. ${RELOAD}`);
    const found = await db.threads.where("session_id").equals(sessionId).filter((t) => t.kind === "anchor" && t.anchor_key === anchorKey).first();
    if (found) return { thread_id: found.id, created: false };
    const article = await db.articles.get(session.article_id);
    if (!article?.text.includes(anchorText)) throw new Rejected("That sentence is not in the article.");
    return insertThread(db, { session_id: sessionId, kind: "anchor", parent_thread_id: null, from_message_id: null, anchor_key: anchorKey, anchor_text: anchorText });
  });
}

/** The tangent on this sentence of an answer: the one already there, or a new one. Its parent is
 *  the answer's thread (rule 1), so going up always ends at an anchor (rule 2). */
export async function openTangent(db: TangentDB, fromMessageId: string, anchorKey: string, anchorText: string) {
  checkAnchor(anchorKey, anchorText);
  return db.transaction("rw", db.sessions, db.threads, db.messages, async () => {
    const answer = await one(db.messages.get(fromMessageId), `That answer is not saved. ${RELOAD}`);
    if (answer.role !== "assistant") throw new Rejected("A tangent branches from one of Claude's answers, not a question.");
    const found = await db.threads.where("from_message_id").equals(fromMessageId).filter((t) => t.anchor_key === anchorKey).first();
    if (found) return { thread_id: found.id, created: false };
    if (!answer.text.includes(anchorText)) throw new Rejected("That sentence is not in the answer.");
    const parent = await thread(db, answer.thread_id);
    return insertThread(db, {
      session_id: parent.session_id,
      kind: "tangent",
      parent_thread_id: parent.id,
      from_message_id: fromMessageId,
      anchor_key: anchorKey,
      anchor_text: anchorText,
    });
  });
}

/** Tap to undo: only a thread that never had a message (rule 3). A tangent branches from an
 *  answer, so a thread with no messages has no tangents either. */
export async function undoThread(db: TangentDB, threadId: string): Promise<void> {
  await db.transaction("rw", db.sessions, db.threads, db.messages, async () => {
    const t = await thread(db, threadId);
    if (await db.messages.where("thread_id").equals(threadId).count()) throw new Refused("This thread has a conversation in it, so it stays.");
    await db.threads.delete(threadId);
    await touch(db, t.session_id);
  });
}

export async function setFlag(db: TangentDB, threadId: string, flagged: boolean): Promise<void> {
  await db.transaction("rw", db.threads, async () => {
    await thread(db, threadId);
    await db.threads.update(threadId, { flagged });
  });
}

/** You have seen every answer in this thread. Returns how many were new. */
export async function markRead(db: TangentDB, threadId: string): Promise<number> {
  return db.transaction("rw", db.threads, db.messages, async () => {
    await thread(db, threadId);
    const at = nowISO();
    return db.messages
      .where("thread_id")
      .equals(threadId)
      .filter((m) => m.role === "assistant" && m.read_at === null)
      .modify({ read_at: at });
  });
}

// ── Questions ────────────────────────────────────────────────────────────────

async function refuseIfWaiting(db: TangentDB, threadId: string) {
  if (await inThread(db, threadId, (m) => m.status === "pending")) {
    throw new Refused("Claude is still answering your last question here. Wait for it, then ask.");
  }
}

/** Saves your question as pending. search is the "Look it up" switch. */
export async function ask(db: TangentDB, threadId: string, text: string, search = false) {
  const question = text.trim();
  if (!question) throw new Rejected("Write a question first.");
  return db.transaction("rw", db.sessions, db.threads, db.messages, async () => {
    const t = await thread(db, threadId);
    await refuseIfWaiting(db, threadId);
    const at = nowISO();
    const id = newId();
    await db.messages.add(
      checked("messages", {
        id,
        thread_id: threadId,
        seq: await nextSeq(db, threadId),
        role: "user",
        text: question,
        status: "pending",
        error: null,
        search,
        citations: [],
        call_id: null,
        truncated: false,
        read_at: null,
        created_at: at,
      }),
    );
    await touch(db, t.session_id, at);
    return { message_id: id };
  });
}

/** Asks a failed or interrupted question again. Its old call and any cut-short answer stay. */
export async function retry(db: TangentDB, messageId: string): Promise<void> {
  await db.transaction("rw", db.messages, async () => {
    const m = await message(db, messageId);
    if (m.role !== "user" || (m.status !== "failed" && m.status !== "interrupted")) {
      throw new Refused("Only a question that failed or was cut short can be asked again.");
    }
    await refuseIfWaiting(db, m.thread_id);
    await db.messages.update(messageId, { status: "pending", error: null });
  });
}

// ── Answers ──────────────────────────────────────────────────────────────────

async function waitingQuestion(db: TangentDB, questionId: string) {
  const q = await message(db, questionId);
  if (q.role !== "user" || q.status !== "pending") throw new Refused("That question is no longer waiting for an answer.");
  return q;
}

const arriving = (db: TangentDB, threadId: string) => inThread(db, threadId, (m) => m.status === "streaming");

/** The answer so far, in full. The first call makes the answer, so its text is never empty. */
export async function streamAnswer(db: TangentDB, questionId: string, textSoFar: string) {
  if (!textSoFar.trim()) throw new Rejected("Save an answer once it has text.");
  return db.transaction("rw", db.messages, async () => {
    const q = await waitingQuestion(db, questionId);
    const answer = await arriving(db, q.thread_id);
    if (answer) {
      await db.messages.update(answer.id, { text: textSoFar });
      return { message_id: answer.id };
    }
    return { message_id: await addAnswer(db, q, { text: textSoFar, status: "streaming" }) };
  });
}

/** Removes a reply that started before a search: it was about the search, not the answer. A
 *  reply still arriving cannot have tangents yet, so nothing hangs off it. */
export async function dropReply(db: TangentDB, questionId: string) {
  return db.transaction("rw", db.messages, async () => {
    const q = await waitingQuestion(db, questionId);
    const answer = await arriving(db, q.thread_id);
    if (answer) await db.messages.delete(answer.id);
  });
}

async function addAnswer(db: TangentDB, q: Message, fields: Partial<Message>): Promise<string> {
  const id = newId();
  const answer = {
    id,
    thread_id: q.thread_id,
    seq: await nextSeq(db, q.thread_id),
    role: "assistant",
    text: "",
    status: "streaming",
    error: null,
    search: false,
    citations: [],
    call_id: null,
    truncated: false,
    read_at: null,
    created_at: nowISO(),
    ...fields,
  };
  await db.messages.add(checked("messages", answer));
  return id;
}

async function saveCall(db: TangentDB, q: Message, call: NewCall): Promise<string> {
  const t = await thread(db, q.thread_id);
  const session = await one(db.sessions.get(t.session_id), `That session is not saved. ${RELOAD}`);
  const id = newId();
  const row: Call = { ...call, id, session_id: t.session_id, thread_id: t.id, asked_message_id: q.id, article_id: session.article_id };
  await db.calls.add(checked("calls", row));
  return id;
}

export interface Finished {
  call: NewCall;
  text: string;
  truncated: boolean;
  citations: Citation[];
}

/** The call, the whole answer, and your question marked done, together. */
export async function finishAnswer(db: TangentDB, questionId: string, { call, text, truncated, citations }: Finished) {
  if (!text.trim()) throw new Rejected("An answer with no text is a failure. Save it as one.");
  return db.transaction("rw", db.sessions, db.threads, db.messages, db.calls, async () => {
    const q = await waitingQuestion(db, questionId);
    const call_id = await saveCall(db, q, call);
    const done = { text, status: "done" as const, call_id, truncated, citations };
    const answer = await arriving(db, q.thread_id);
    if (answer) await db.messages.put(checked("messages", { ...answer, ...done }));
    const message_id = answer?.id ?? (await addAnswer(db, q, done));
    await db.messages.update(questionId, { status: "done" });
    await touch(db, (await thread(db, q.thread_id)).session_id);
    return { message_id, call_id };
  });
}

/** Your question marked failed with a reason you can read, the call if one was made, and any
 *  answer that had started kept as interrupted. */
export async function failAnswer(db: TangentDB, questionId: string, { call, reason }: { call: NewCall | null; reason: string }) {
  return db.transaction("rw", db.sessions, db.threads, db.messages, db.calls, async () => {
    const q = await waitingQuestion(db, questionId);
    const call_id = call ? await saveCall(db, q, call) : null;
    const answer = await arriving(db, q.thread_id);
    if (answer) await db.messages.update(answer.id, { status: "interrupted", call_id });
    await db.messages.put(checked("messages", { ...q, status: "failed", error: reason }));
    return { call_id };
  });
}

// ── Visits ───────────────────────────────────────────────────────────────────

const ZONED = /(Z|[+-]\d{2}:\d{2})$/;

/** Appends to the trail in the order given. Never edits or removes a visit. */
export async function addVisits(db: TangentDB, sessionId: string, visits: NewVisit[]): Promise<number> {
  if (visits.length === 0 || visits.length > VISITS_PER_BATCH) throw new Rejected(`Save 1 to ${VISITS_PER_BATCH} visits at a time.`);
  const times = visits.map((v) => {
    const at = new Date(v.at);
    if (!ZONED.test(v.at) || Number.isNaN(at.getTime())) throw new Rejected("A visit's time needs its zone, like 2026-10-05T18:00:00.000Z.");
    return at.toISOString();
  });
  return db.transaction("rw", db.sessions, db.visits, async () => {
    await one(db.sessions.get(sessionId), `That session is not saved. ${RELOAD}`);
    const last = await db.visits.where("[session_id+seq]").between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey]).last();
    const rows: VisitRow[] = visits.map((v, i) => checked("visits", { ...v, at: times[i], session_id: sessionId, seq: (last?.seq ?? 0) + i + 1 }));
    await db.visits.bulkAdd(rows);
    return rows.length;
  });
}
