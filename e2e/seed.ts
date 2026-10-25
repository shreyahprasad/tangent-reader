import { db } from "../src/app/db";
import type { NewCall } from "../src/store/schema";
import { addVisits, ask, createSession, finishAnswer, markRead, openAnchor, openTangent, setFlag } from "../src/store/store";
import type { NewVisit } from "../src/tangent/visits";

// Runs in the page, loaded from the dev server by fake.ts: a made-up session built through the
// app's own store, so it is saved exactly as the page saves one. Never real reading data.

const P = (n: number) =>
  `Paragraph ${n} opens with a plain claim about the subject at hand. It goes on to give a reason that takes a little while to say. It closes on a third and final point.`;

export const ARTICLE = Array.from({ length: 16 }, (_, n) => P(n)).join("\n\n");

const call: NewCall = {
  model: "claude-sonnet-5-5",
  served_model: "claude-sonnet-5-5",
  request_json: '{"model":"claude-sonnet-5-5","messages":[]}',
  response_json: "{}",
  status: "ok",
  stop_reason: "end_turn",
  error_kind: null,
  http_status: 200,
  request_id: "req_seed",
  input_tokens: 1200,
  output_tokens: 300,
  cache_write_tokens: 5000,
  cache_read_tokens: 0,
  web_search_requests: 0,
  cost_usd: 0.0179,
  web_search_cost_usd: null,
  started_at: "2026-10-09T10:00:00.000Z",
  finished_at: "2026-10-09T10:00:02.000Z",
  latency_ms: 2000,
  prompt_version: 1,
  first_token_ms: 800,
};

/** A question and its answer, read. Returns the answer's id. */
async function said(threadId: string, question: string, answer: string) {
  const { message_id } = await ask(db, threadId, question);
  const done = await finishAnswer(db, message_id, { call, text: answer, truncated: false, citations: [] });
  await markRead(db, threadId);
  return done.message_id;
}

export type Name = "tA" | "tB" | "tC";
export type Ids = Record<"s1" | Name | "mA2", string> & { loops: string[] };

export interface Seed {
  /** Where you last were in it: a visit, its thread named. */
  lastVisit?: Omit<NewVisit, "at" | "thread_id" | "via"> & { thread?: Name };
  /** Flagged threads beyond tA, tB and tC, each on its own sentence, newest last. A question
   *  makes its label; null leaves it at its sentence. */
  loops?: (string | null)[];
  /** tA flagged too. */
  flagA?: boolean;
}

/** On the article: tA on paragraph 0 with a tangent tB below it, and tC on paragraph 8. */
export async function seed({ lastVisit, loops = [], flagA = false }: Seed = {}): Promise<Ids> {
  const { session_id: s1 } = await createSession(db, { text: ARTICLE, title: "A test article" });
  const tA = (await openAnchor(db, s1, "p0:s0", "Paragraph 0 opens with a plain claim about the subject at hand.")).thread_id;
  const mA2 = await said(tA, "What is the claim?", "It means one thing. It also means another.");
  const tB = (await openTangent(db, mA2, "p0:s1", "It also means another.")).thread_id;
  await said(tB, "Another how?", "Like this. And like that.");
  const tC = (await openAnchor(db, s1, "p8:s1", "It goes on to give a reason that takes a little while to say.")).thread_id;
  await said(tC, "Why does it take a while?", "Because the reason is long.");
  if (flagA) await setFlag(db, tA, true);

  const ids = { s1, tA, tB, tC, mA2 };
  const made: string[] = [];
  for (const [i, question] of loops.entries()) {
    const n = i + 1; // paragraphs 1 to 7 have no thread yet
    const { thread_id } = await openAnchor(db, s1, `p${n}:s2`, "It closes on a third and final point.");
    if (question) await said(thread_id, question, "An answer.");
    await setFlag(db, thread_id, true);
    // A minute apart, so newest first is the order made, whatever the clock did.
    await db.threads.update(thread_id, { created_at: new Date(Date.UTC(2026, 9, 9, 11, i)).toISOString() });
    await db.messages.where("thread_id").equals(thread_id).modify({ created_at: new Date(Date.UTC(2026, 9, 9, 11, i)).toISOString() });
    made.push(thread_id);
  }
  if (flagA) {
    const late = new Date(Date.UTC(2026, 9, 9, 12, 0)).toISOString();
    await db.messages.where("thread_id").equals(tA).modify({ created_at: late });
  }

  if (lastVisit) {
    const { thread, ...visit } = lastVisit;
    await addVisits(db, s1, [{ ...visit, at: "2026-10-09T12:30:00.000Z", thread_id: thread ? { tA, tB, tC }[thread] : null, via: "open" }]);
  }
  return { ...ids, loops: made };
}

/** The session's trail, oldest first, as saved. */
export async function visitsOf(sessionId: string) {
  const rows = await db.visits.where("session_id").equals(sessionId).sortBy("seq");
  return rows.map(({ view, thread_id, anchor_key, sheet, via }) => ({ view, thread_id, anchor_key, sheet, via }));
}
