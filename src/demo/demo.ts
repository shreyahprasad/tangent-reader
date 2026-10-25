import type { NewCall, TangentDB } from "../store/schema";
import { articleId, ask, createSession, finishAnswer, markRead, openAnchor, openTangent } from "../store/store";
import { normalizeArticle } from "../tangent/tangent";
import { parseArticle, flattenSentences } from "../tangent/sentences";
import TEXT from "./lovelace-note-a.txt?raw";

// Demo mode (docs/design.md, Demo): a sample article and a session written by hand, so you can
// explore with no key. The text is public domain. Every answer here was written by a person from
// checked sources, never by Claude and never from anyone's reading. It is built through the app's
// own store, so it is saved exactly as a real session is. Asking a new question needs your key.

export const DEMO_TITLE = "Ada Lovelace, Note A (1843): demo";
/** Where the text was copied from, word for word. The page shows it under the title. */
export const DEMO_SOURCE = "https://www.fourmilab.ch/babbage/sketch.html";

/** A step in the demo: a question on a sentence and its answer, with tangents from its sentences. */
export interface Step {
  on: string;
  question: string;
  answer: string;
  tangents?: Step[];
}

export const DEMO: Step[] = [
  {
    on: "Supposing, for instance, that the fundamental relations of pitched sounds",
    question: "Did she really imagine machine-made music?",
    answer:
      "Yes, in 1843. She reasoned that if the rules of harmony could be written as symbols, the engine could work on them the way it works on numbers. It took more than a century to happen. The Illiac Suite, composed with a computer at the University of Illinois in 1957, is often called the first computer-generated score.",
  },
  {
    on: "The distinctive characteristic of the Analytical Engine",
    question: "What was Jacquard's loom?",
    answer:
      "Joseph Marie Jacquard's loom, from the early 1800s, read a chain of punched cards to choose which threads to lift on each pass. A hole meant lift, no hole meant stay down. Change the cards and the same loom wove a different pattern. Lovelace's point is that Babbage borrowed this idea, with cards that carry operations instead of patterns.",
    tangents: [
      {
        on: "A hole meant lift, no hole meant stay down.",
        question: "Where did punched cards go after the loom?",
        answer:
          "Herman Hollerith used punched cards to count the 1890 US census, far faster than the 1880 count had gone by hand. His company later merged into the firm that took the name IBM in 1924. Cards stayed the everyday way to feed programs and data to computers until the 1970s.",
        tangents: [
          {
            on: "Cards stayed the everyday way to feed programs and data to computers until the 1970s.",
            question: "What replaced them?",
            answer:
              "Terminals, where you typed a program straight into the computer and got the result back. The first ones were teletypes that printed on paper, and screens took over through the 1970s. By the mid-1980s personal computers had made card decks rare.",
          },
        ],
      },
    ],
  },
  {
    on: "We are not aware of its being on record",
    question: "Did she think the engine could think?",
    answer:
      "No. Later in the same paper, in Note G, she writes that the engine “has no pretensions whatever to originate anything” and can do only what we know how to order it to perform. Here she is saying only that nobody had seriously proposed such a machine before.",
    tangents: [
      {
        on: "Later in the same paper, in Note G,",
        question: "Did anyone answer her?",
        answer:
          "Alan Turing did, in his 1950 paper “Computing Machinery and Intelligence.” He named it Lady Lovelace’s Objection. He replied that machines take him by surprise with great frequency, and that originating something may be no more than doing what nobody predicted.",
        tangents: [
          {
            on: "He replied that machines take him by surprise",
            question: "So can AI be original?",
            answer:
              "It is still argued. Today’s models make text, music and images nobody wrote down beforehand, which looks like Turing’s kind of surprise. Others side with Lovelace: the output recombines what the system learned from people, so the origin is still human. The answer turns on what you count as originating.",
          },
        ],
      },
    ],
  },
];

/** The sentence that starts with `start`, with its place. Throws when the text has none, so a
 *  changed article or answer fails the tests rather than the page. */
export function sentenceAt(text: string, start: string) {
  const found = flattenSentences(parseArticle(text)).find((s) => s.text.trim().startsWith(start));
  if (!found) throw new Error(`No sentence starts with "${start}".`);
  return found;
}

// A demo answer cost nothing and called nothing: no tokens, no request id, so no total counts it.
const AT = "2026-10-24T00:00:00.000Z";
const NO_CALL: NewCall = {
  model: "demo",
  served_model: null,
  request_json: "{}",
  response_json: null,
  status: "ok",
  stop_reason: "end_turn",
  error_kind: null,
  http_status: null,
  request_id: null,
  input_tokens: 0,
  output_tokens: 0,
  cache_write_tokens: 0,
  cache_read_tokens: 0,
  web_search_requests: 0,
  cost_usd: 0,
  web_search_cost_usd: null,
  started_at: AT,
  finished_at: AT,
  latency_ms: 0,
  prompt_version: null,
  first_token_ms: null,
};

async function answered(db: TangentDB, threadId: string, step: Step) {
  const { message_id } = await ask(db, threadId, step.question);
  const done = await finishAnswer(db, message_id, { call: NO_CALL, text: step.answer, truncated: false, citations: [] });
  await markRead(db, threadId);
  for (const t of step.tangents ?? []) {
    const s = sentenceAt(step.answer, t.on);
    await answered(db, (await openTangent(db, done.message_id, s.key, s.text)).thread_id, t);
  }
}

/** The demo session: the one already here, or a new one. Returns its id. */
export async function openDemo(db: TangentDB): Promise<string> {
  const article_id = await articleId(normalizeArticle(TEXT));
  const here = await db.sessions.where("article_id").equals(article_id).filter((s) => s.title === DEMO_TITLE).first();
  if (here) return here.id;
  const { session_id } = await createSession(db, { text: TEXT, title: DEMO_TITLE, source: "url", source_ref: DEMO_SOURCE });
  for (const step of DEMO) {
    const s = sentenceAt(TEXT, step.on);
    await answered(db, (await openAnchor(db, session_id, s.key, s.text)).thread_id, step);
  }
  return session_id;
}
