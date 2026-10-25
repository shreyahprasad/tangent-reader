import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { TangentDB, VERSIONS, type NewCall } from "./schema";
import { ask, createSession, finishAnswer, openAnchor } from "./store";

// For tests only: a database in memory, and made-up reading. Never real reading data.

export const ARTICLE = "Rivers carve canyons over millions of years.\n\nThe Colorado River cut the Grand Canyon. It is still cutting.";
export const FIRST = "Rivers carve canyons over millions of years.";
export const ANSWER = "Water carries grit that grinds the rock. Floods do most of the work.";

/** A database of its own, in memory. Pass the same factory to open one database twice. */
export const freshDB = (factory = new IDBFactory(), versions = VERSIONS) => new TangentDB({ indexedDB: factory, IDBKeyRange }, versions);

export const aCall = (extra: Partial<NewCall> = {}): NewCall => ({
  model: "claude-test",
  served_model: "claude-test",
  request_json: '{"model":"claude-test","messages":[]}',
  response_json: "{}",
  status: "ok",
  stop_reason: "end_turn",
  error_kind: null,
  http_status: 200,
  request_id: "req_1",
  input_tokens: 1200,
  output_tokens: 300,
  cache_write_tokens: 5000,
  cache_read_tokens: 0,
  web_search_requests: 0,
  cost_usd: 0.0179,
  web_search_cost_usd: null,
  started_at: "2026-10-12T10:00:00.000Z",
  finished_at: "2026-10-12T10:00:02.000Z",
  latency_ms: 2000,
  prompt_version: 1,
  first_token_ms: 800,
  ...extra,
});

/** A thread's messages, in order. */
export const messagesIn = (db: TangentDB, threadId: string) => db.messages.where("thread_id").equals(threadId).sortBy("seq");

/** A session, an anchor on its first sentence, one question and its answer. */
export async function answeredThread(db: TangentDB, text = ARTICLE) {
  const { session_id } = await createSession(db, { text });
  const { thread_id } = await openAnchor(db, session_id, "p0:s0", text.split("\n")[0]);
  const { message_id: question_id } = await ask(db, thread_id, "Why so slow?");
  const { message_id: answer_id } = await finishAnswer(db, question_id, { call: aCall(), text: ANSWER, truncated: false, citations: [] });
  return { session_id, thread_id, question_id, answer_id };
}
