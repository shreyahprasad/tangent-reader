import { webLink } from "../import/link";
import type { Message } from "../tangent/data";
import type { Rows, TableName } from "./schema";

// The store's rules (docs/design.md, Data), pure and tested (rules.test.ts). store.ts checks
// every row it writes against these, and an import checks the whole file with them before writing
// anything.
//
// 1. An anchor has no parent and no from_message_id. A tangent has both, and from_message_id is an
//    answer in the parent thread.
// 2. Going up through parents always ends at an anchor. No cycles.
// 3. Only a thread with no messages can be deleted (store.ts, undoThread).
// 4. One question in flight per thread.
// 5. request_json is kept exactly as given, and rebuilds exactly what was sent (src/claude/answer.test.ts).
// 6. A write that changes more than one table is one transaction (store.ts).
// 7. Every change to the database ships a migration (schema.ts).
// 8. On load, a question still pending or an answer still streaming becomes interrupted.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH = /^[0-9a-f]{64}$/;
const TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const ANCHOR_KEY = /^p\d+:s\d+$/;
const VIAS = ["sentence", "dot", "branch", "breadcrumb", "map", "back", "start", "resume", "open"];

/** Said on a question the tab closed under (rule 8). */
export const INTERRUPTED = "The tab closed before the answer finished. Ask again.";

/** Keys that would carry the API key if a request's options were saved in place of its body. */
const HEADER_KEYS = ["headers", "apiKey", "api_key", "x-api-key", "authorization"];

type Check = (v: unknown) => boolean;
type Row = Record<string, unknown>;

const isRow = (v: unknown): v is Row => typeof v === "object" && v !== null && !Array.isArray(v);
const str: Check = (v) => typeof v === "string";
const text: Check = (v) => typeof v === "string" && v.trim() !== "";
const id: Check = (v) => typeof v === "string" && UUID.test(v);
const time: Check = (v) => typeof v === "string" && TIME.test(v);
const count: Check = (v) => Number.isInteger(v) && (v as number) >= 0;
const seq: Check = (v) => Number.isInteger(v) && (v as number) >= 1;
const amount: Check = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0;
const bool: Check = (v) => typeof v === "boolean";
const anchorKey: Check = (v) => typeof v === "string" && ANCHOR_KEY.test(v);
const oneOf = (...allowed: unknown[]): Check => (v) => allowed.includes(v);
const orNull = (check: Check): Check => (v) => v === null || check(v);
const citations: Check = (v) =>
  Array.isArray(v) && v.every((c) => isRow(c) && Object.keys(c).length === 2 && str(c.url) && str(c.title));

/** Every field of every table, and what it may hold. Exports carry these fields and no others. */
export const FIELDS: { [T in TableName]: Record<keyof Rows[T][number], Check> } = {
  articles: {
    id: (v) => typeof v === "string" && HASH.test(v),
    text,
    title: text,
    created_at: time,
    source: oneOf("paste", "url", "file"),
    source_ref: orNull(text),
  },
  sessions: { id, article_id: (v) => typeof v === "string" && HASH.test(v), title: text, created_at: time, updated_at: time },
  threads: {
    id,
    session_id: id,
    kind: oneOf("anchor", "tangent"),
    parent_thread_id: orNull(id),
    from_message_id: orNull(id),
    anchor_key: anchorKey,
    anchor_text: text,
    flagged: bool,
    created_at: time,
  },
  messages: {
    id,
    thread_id: id,
    seq,
    role: oneOf("user", "assistant"),
    text,
    status: oneOf("pending", "streaming", "done", "interrupted", "failed"),
    error: orNull(text),
    search: bool,
    citations,
    call_id: orNull(id),
    truncated: bool,
    read_at: orNull(time),
    created_at: time,
  },
  calls: {
    id,
    session_id: id,
    thread_id: id,
    asked_message_id: id,
    article_id: (v) => typeof v === "string" && HASH.test(v),
    model: text,
    served_model: orNull(text),
    request_json: str,
    response_json: orNull(str),
    status: oneOf("ok", "error"),
    stop_reason: orNull(str),
    error_kind: orNull(text),
    http_status: orNull(count),
    request_id: orNull(str),
    input_tokens: count,
    output_tokens: count,
    cache_write_tokens: count,
    cache_read_tokens: count,
    web_search_requests: count,
    cost_usd: orNull(amount),
    web_search_cost_usd: orNull(amount),
    started_at: time,
    finished_at: time,
    latency_ms: count,
    prompt_version: orNull(count),
    first_token_ms: orNull(count),
  },
  visits: {
    session_id: id,
    seq,
    at: time,
    view: oneOf("article", "thread"),
    thread_id: orNull(id),
    anchor_key: orNull(anchorKey),
    sheet: orNull(oneOf("half", "full")),
    via: oneOf(...VIAS),
  },
};

const QUESTION_STATUS = ["pending", "done", "failed", "interrupted"];
const ANSWER_STATUS = ["streaming", "done", "interrupted"];

function requestProblem(json: string): string | null {
  let body: unknown;
  try {
    body = JSON.parse(json);
  } catch {
    return "its request is not JSON";
  }
  if (!isRow(body)) return "its request is not a request body";
  return HEADER_KEYS.some((k) => k in body) ? "its request carries headers, which could hold your key" : null;
}

/** What one row says about itself, beyond each field on its own. */
const SHAPES: { [T in TableName]: (row: Rows[T][number]) => string | null } = {
  articles: (a) => {
    if ((a.source === "paste") !== (a.source_ref === null)) return "a link or file needs its source, a paste has none";
    // The page draws a link's source as a link: a backup must not slip in javascript: or the like.
    if (a.source === "url" && !webLink(a.source_ref)) return "a link is a web address (http or https)";
    return null;
  },
  sessions: () => null,
  threads: (t) => {
    const loose = t.parent_thread_id === null && t.from_message_id === null;
    const tied = t.parent_thread_id !== null && t.from_message_id !== null;
    if (t.kind === "anchor" && !loose) return "an anchor has no parent and no answer it branched from";
    if (t.kind === "tangent" && !tied) return "a tangent needs its parent and the answer it branched from";
    return null;
  },
  messages: (m) => {
    if (m.role === "user") {
      if (!QUESTION_STATUS.includes(m.status)) return `a question cannot be ${m.status}`;
      if ((m.error !== null) !== (m.status === "failed" || m.status === "interrupted")) return "only a failed or interrupted question says why";
      if (m.call_id !== null || m.citations.length > 0 || m.truncated || m.read_at !== null) return "a question has no call, sources, cut or read time";
      return null;
    }
    if (!ANSWER_STATUS.includes(m.status)) return `an answer cannot be ${m.status}`;
    if (m.error !== null || m.search) return "an answer has no error and no search switch";
    if (m.status === "done" && m.call_id === null) return "a finished answer has its call";
    if (m.status === "streaming" && m.call_id !== null) return "an answer still arriving has no call yet";
    return null;
  },
  calls: (c) => ((c.status === "ok") !== (c.error_kind === null) ? "only a failed call has an error kind" : requestProblem(c.request_json)),
  visits: (v) => {
    const placed = v.thread_id !== null && v.sheet !== null;
    const bare = v.thread_id === null && v.sheet === null;
    return (v.view === "thread" ? placed : bare) ? null : "a thread visit has its thread and sheet, an article visit has neither";
  },
};

/** What is wrong with one row of a table, or null. Exact fields only: none missing, none extra. */
export function rowProblem<T extends TableName>(table: T, row: unknown): string | null {
  if (!isRow(row)) return "it is not a row";
  const fields = FIELDS[table] as Record<string, Check>;
  const extra = Object.keys(row).find((k) => !(k in fields));
  if (extra) return `${extra} is not a field`;
  const bad = Object.keys(fields).find((f) => !fields[f](row[f]));
  if (bad) return bad in row ? `${bad} is not valid` : `${bad} is missing`;
  return SHAPES[table](row as never);
}

/** A row with only its table's fields, so nothing else can leave in an export. */
export function pick<T extends TableName>(table: T, row: Rows[T][number]): Rows[T][number] {
  return Object.fromEntries(Object.keys(FIELDS[table]).map((f) => [f, (row as unknown as Row)[f]])) as unknown as Rows[T][number];
}

/** Rule 8: what a message left in flight becomes, or null when it was not in flight. */
export function interrupted(m: Message): Message | null {
  if (m.role === "user" && m.status === "pending") return { ...m, status: "interrupted", error: INTERRUPTED };
  if (m.role === "assistant" && m.status === "streaming") return { ...m, status: "interrupted" };
  return null;
}

const dupe = <T>(items: T[], key: (item: T) => string) => {
  const seen = new Set<string>();
  return items.find((item) => seen.size === seen.add(key(item)).size);
};

/** What is wrong with a whole file of rows, or null: every row, every reference and every rule.
 *  hashes maps each article id to the sha-256 of its text, worked out by the caller. */
export function fileProblem(rows: Rows, hashes: Map<string, string>): string | null {
  for (const table of Object.keys(FIELDS) as TableName[]) {
    if (!Array.isArray(rows[table])) return `${table} is missing`;
    for (const [i, row] of rows[table].entries()) {
      const problem = rowProblem(table, row);
      if (problem) return `${table} row ${i + 1}: ${problem}`;
    }
  }
  const { articles, sessions, threads, messages, calls, visits } = rows;
  for (const table of ["articles", "sessions", "threads", "messages", "calls"] as const) {
    const twice = dupe<{ id: string }>(rows[table], (r) => r.id);
    if (twice) return `${table} has ${twice.id} twice`;
  }
  if (dupe(visits, (v) => `${v.session_id} ${v.seq}`)) return "a visit's place in its trail is taken twice";
  if (dupe(messages, (m) => `${m.thread_id} ${m.seq}`)) return "a message's place in its thread is taken twice";

  const article = new Map(articles.map((a) => [a.id, a]));
  const session = new Map(sessions.map((s) => [s.id, s]));
  const thread = new Map(threads.map((t) => [t.id, t]));
  const message = new Map(messages.map((m) => [m.id, m]));
  const call = new Map(calls.map((c) => [c.id, c]));

  const tampered = articles.find((a) => hashes.get(a.id) !== a.id);
  if (tampered) return `article ${tampered.id} does not match its text`;
  const orphan = sessions.find((s) => !article.has(s.article_id));
  if (orphan) return `session ${orphan.id} has no article`;

  for (const t of threads) {
    const s = session.get(t.session_id);
    if (!s) return `thread ${t.id} has no session`;
    if (t.kind === "anchor") {
      if (!article.get(s.article_id)!.text.includes(t.anchor_text)) return `thread ${t.id}'s sentence is not in the article`;
      continue;
    }
    const parent = thread.get(t.parent_thread_id!);
    const from = message.get(t.from_message_id!);
    if (!parent || parent.session_id !== t.session_id) return `thread ${t.id} has no parent in its session`;
    if (!from || from.role !== "assistant" || from.thread_id !== parent.id) return `thread ${t.id} does not branch from an answer in its parent`;
    if (!from.text.includes(t.anchor_text)) return `thread ${t.id}'s sentence is not in the answer`;
  }
  if (dupe(threads.filter((t) => t.kind === "anchor"), (t) => `${t.session_id} ${t.anchor_key}`)) return "a sentence is anchored twice";
  if (dupe(threads.filter((t) => t.kind === "tangent"), (t) => `${t.from_message_id} ${t.anchor_key}`)) return "a sentence of an answer has two tangents";
  for (const t of threads) {
    const above = new Set<string>();
    for (let up = t; up.parent_thread_id; up = thread.get(up.parent_thread_id)!) {
      if (above.has(up.id)) return `thread ${t.id} is its own ancestor`;
      above.add(up.id);
    }
  }

  for (const m of messages) {
    if (!thread.has(m.thread_id)) return `message ${m.id} has no thread`;
    if (m.call_id !== null && !call.has(m.call_id)) return `message ${m.id} has no call`;
  }
  if (dupe(messages.filter((m) => m.status === "pending"), (m) => m.thread_id)) return "a thread has two questions waiting";
  if (dupe(messages.filter((m) => m.status === "streaming"), (m) => m.thread_id)) return "a thread has two answers arriving";

  for (const c of calls) {
    const t = thread.get(c.thread_id);
    const asked = message.get(c.asked_message_id);
    if (!session.has(c.session_id) || t?.session_id !== c.session_id) return `call ${c.id} has no thread in its session`;
    if (asked?.role !== "user" || asked.thread_id !== c.thread_id) return `call ${c.id} has no question in its thread`;
    if (session.get(c.session_id)!.article_id !== c.article_id) return `call ${c.id} names another article`;
  }
  const lost = visits.find((v) => !session.has(v.session_id));
  return lost ? `a visit has no session` : null;
}
