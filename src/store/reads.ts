import Dexie from "dexie";
import type { Role } from "../tangent/context";
import type { Loop, Message, Session, SessionSummary, Thread, Visit } from "../tangent/data";
import { TRAIL_LENGTH } from "../tangent/style";
import { lastActive, unseen } from "../tangent/tangent";
import { NotFound, Refused } from "./errors";
import type { SessionRow, TangentDB, ThreadRow, VisitRow } from "./schema";

// What the page reads (docs/design.md, Data), in the shapes of src/tangent/data.ts. The call log
// never leaves the store: a session carries its token and cost totals only.

const trailOf = (db: TangentDB, sessionId: string) =>
  db.visits.where("[session_id+seq]").between([sessionId, Dexie.minKey], [sessionId, Dexie.maxKey]).reverse();

const visit = ({ session_id: _, ...v }: VisitRow): Visit => v;
const threadOf = ({ session_id: _, ...t }: ThreadRow): Thread => t;

/** A session's threads, oldest first, and their messages, thread by thread in order. */
async function contents(db: TangentDB, sessionId: string) {
  const threads = await db.threads.where("session_id").equals(sessionId).sortBy("created_at");
  const order = new Map(threads.map((t, i) => [t.id, i]));
  const messages = (await db.messages.where("thread_id").anyOf([...order.keys()]).toArray()).sort(
    (a, b) => order.get(a.thread_id)! - order.get(b.thread_id)! || a.seq - b.seq,
  );
  return { threads, messages };
}

async function totals(db: TangentDB, s: SessionRow): Promise<Omit<SessionSummary, "last_visit">> {
  const { threads, messages } = await contents(db, s.id);
  const calls = await db.calls.where("session_id").equals(s.id).toArray();
  const cost = calls.reduce((sum, c) => sum + (c.cost_usd ?? 0), 0);
  return {
    id: s.id,
    title: s.title,
    created_at: s.created_at,
    updated_at: s.updated_at,
    threads: threads.length,
    questions: messages.filter((m) => m.role === "user").length,
    unread: messages.filter(unseen).length,
    pending: messages.filter((m) => m.status === "pending").length,
    flagged: threads.filter((t) => t.flagged).length,
    tokens: calls.reduce((sum, c) => sum + c.input_tokens + c.output_tokens + c.cache_write_tokens + c.cache_read_tokens, 0),
    cost_usd: Math.round(cost * 10_000) / 10_000,
  };
}

/** Every session with its totals and the last place you were, most recently active first. */
export async function sessionSummaries(db: TangentDB): Promise<SessionSummary[]> {
  return db.transaction("r", db.sessions, db.threads, db.messages, db.calls, db.visits, async () => {
    const sessions = await db.sessions.toArray();
    const listed = await Promise.all(
      sessions.map(async (s) => {
        const last = await trailOf(db, s.id).first();
        return { ...(await totals(db, s)), last_visit: last ? visit(last) : null };
      }),
    );
    return listed.sort((a, b) => lastActive(b).localeCompare(lastActive(a)));
  });
}

/** Threads left open across every session: flagged, or with answers you have not seen, newest
 *  activity first. Each carries your first question in it and its sentence, for a label. */
export async function loops(db: TangentDB): Promise<Loop[]> {
  return db.transaction("r", db.sessions, db.threads, db.messages, async () => {
    const titles = new Map((await db.sessions.toArray()).map((s) => [s.id, s.title]));
    const byThread = new Map<string, Message[]>();
    await db.messages.orderBy("[thread_id+seq]").each((m) => byThread.set(m.thread_id, [...(byThread.get(m.thread_id) ?? []), m]));
    const open = (await db.threads.toArray()).flatMap((t) => {
      const own = byThread.get(t.id) ?? [];
      const unread = own.filter(unseen).length;
      if (!t.flagged && unread === 0) return [];
      const times = own.map((m) => m.created_at).sort();
      return [
        {
          thread_id: t.id,
          session_id: t.session_id,
          session_title: titles.get(t.session_id) ?? "",
          anchor_text: t.anchor_text,
          flagged: t.flagged,
          first_question: own.find((m) => m.role === "user")?.text ?? null,
          unread,
          last_message_at: times[times.length - 1] ?? null,
          created_at: t.created_at,
        },
      ];
    });
    return open
      .sort((a, b) => (b.last_message_at ?? b.created_at).localeCompare(a.last_message_at ?? a.created_at))
      .map(({ created_at: _, ...loop }) => loop);
  });
}

/** One session in full: its article, every thread and message, and the last TRAIL_LENGTH places
 *  you went, newest first. */
export async function session(db: TangentDB, sessionId: string): Promise<Session> {
  return db.transaction("r", [db.articles, db.sessions, db.threads, db.messages, db.calls, db.visits], async () => {
    const s = await db.sessions.get(sessionId);
    if (!s) throw new NotFound("That session is not saved.");
    const article = (await db.articles.get(s.article_id))!;
    const { threads, messages } = await contents(db, sessionId);
    return {
      session: await totals(db, s),
      article: article.text,
      source: article.source,
      source_ref: article.source_ref,
      threads: threads.map(threadOf),
      messages,
      trail: (await trailOf(db, sessionId).limit(TRAIL_LENGTH).toArray()).map(visit),
    };
  });
}

/** What you have spent on Claude from this device: in all, and this calendar month (your time).
 *  unpriced counts calls by a model this page has no price for, left out of both sums. */
export interface Spending {
  total_usd: number;
  month_usd: number;
  calls: number;
  unpriced: number;
}

export async function spending(db: TangentDB, now = new Date()): Promise<Spending> {
  const calls = await db.calls.toArray();
  const thisMonth = (iso: string) => {
    const at = new Date(iso);
    return at.getFullYear() === now.getFullYear() && at.getMonth() === now.getMonth();
  };
  const sum = (picked: typeof calls) => Math.round(picked.reduce((usd, c) => usd + (c.cost_usd ?? 0), 0) * 10_000) / 10_000;
  return {
    total_usd: sum(calls),
    month_usd: sum(calls.filter((c) => thisMonth(c.started_at))),
    calls: calls.length,
    unpriced: calls.filter((c) => c.cost_usd === null).length,
  };
}

/** When the newest call on this session's article by this model began, if it wrote or read the
 *  cache: the spending guard's clock for whether the article is still cached. Null for none. */
export async function lastCacheCall(db: TangentDB, sessionId: string, model: string): Promise<string | null> {
  return db.transaction("r", db.sessions, db.calls, async () => {
    const s = await db.sessions.get(sessionId);
    if (!s) throw new NotFound("That session is not saved.");
    const calls = await db.calls.filter((c) => c.article_id === s.article_id && c.served_model === model && c.cache_write_tokens + c.cache_read_tokens > 0).toArray();
    return calls.reduce<string | null>((last, c) => (last === null || c.started_at > last ? c.started_at : last), null);
  });
}

/** What the Claude client needs to ask one question. */
export interface Prompt {
  session_id: string;
  thread_id: string;
  article_id: string;
  article: string;
  /** The tapped sentences, the anchor first. */
  path: string[];
  /** The thread's answered turns in order, then this question. */
  turns: [Role, string][];
  /** "Look it up" was on for this question. */
  search: boolean;
}

/** The prompt for a question waiting for its answer. Only answered turns go in: a failed or
 *  interrupted question has no answer, so it would be two questions in a row, and an interrupted
 *  answer is cut short. A question no longer waiting is refused, so it is never paid for twice. */
export async function promptFor(db: TangentDB, questionId: string): Promise<Prompt> {
  return db.transaction("r", db.articles, db.sessions, db.threads, db.messages, async () => {
    const q = await db.messages.get(questionId);
    if (q?.role !== "user") throw new NotFound("That question is not saved.");
    if (q.status !== "pending") throw new Refused("That question is no longer waiting for an answer.");
    const thread = (await db.threads.get(q.thread_id))!;
    const path: string[] = [];
    for (let up: ThreadRow | undefined = thread; up; up = up.parent_thread_id ? await db.threads.get(up.parent_thread_id) : undefined) {
      path.unshift(up.anchor_text); // up to the anchor (rule 2)
    }
    const s = (await db.sessions.get(thread.session_id))!;
    const article = (await db.articles.get(s.article_id))!;
    const earlier = await db.messages
      .where("[thread_id+seq]")
      .between([thread.id, Dexie.minKey], [thread.id, q.seq])
      .filter((m) => m.status === "done")
      .toArray();
    return {
      session_id: s.id,
      thread_id: thread.id,
      article_id: article.id,
      article: article.text,
      path,
      turns: [...earlier.map((m): [Role, string] => [m.role, m.text]), ["user", q.text]],
      search: q.search,
    };
  });
}
