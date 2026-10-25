import type { BetaMessage, BetaMessageDeltaUsage, BetaRawMessageStreamEvent } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { nowISO } from "../shell/dates";
import { Refused } from "../store/errors";
import { promptFor } from "../store/reads";
import type { NewCall, TangentDB } from "../store/schema";
import { callLock, dropReply, failAnswer, finishAnswer, lockManager, streamAnswer } from "../store/store";
import { PROMPT_VERSION } from "../tangent/context";
import { STREAM_SAVE_MS } from "../tangent/style";
import { cost, type Usage } from "./cost";
import { classify } from "./client";
import { REASONS, type Kind } from "./reasons";
import { requestFor, storedRequest, type Request } from "./request";
import { answerOf, isStep } from "./search";

// Answers one pending question from this tab (docs/design.md, Asking Claude): build the request,
// stream the reply into the store as it arrives, then save the call and the answer, or the call
// and a reason you can read. Every call is saved in full,
// worked or not. A tab closed mid-call saves nothing more: rule 8 marks it interrupted next time,
// and with no usage known there is no call row for it.
//
// The tab holds the question's call lock throughout, so another tab opening the store meanwhile
// leaves this question alone instead of marking it interrupted (store.ts, openStore).

/** The part of the SDK client this uses, so tests can hand in a fake. */
export interface Client {
  beta: { messages: { stream(body: Request): AnswerStream } };
}

export interface AnswerStream extends AsyncIterable<BetaRawMessageStreamEvent> {
  finalMessage(): Promise<BetaMessage>;
  abort(): void;
  readonly request_id?: string | null;
}

/** Never throws: every outcome is saved, so a waiting question always ends done or failed. client
 *  is null when you have not added a key. A second call for a question already being asked, as
 *  from a double tap, does nothing. */
export async function answer(db: TangentDB, questionId: string, client: Client | null, model: string): Promise<void> {
  const locks = lockManager();
  if (!locks) return askClaude(db, questionId, client, model);
  await locks.request(callLock(questionId), { ifAvailable: true }, (lock) => lock && askClaude(db, questionId, client, model));
}

/** How a call ended, as the call log keeps it. */
type Outcome = Pick<NewCall, "response_json" | "status" | "stop_reason" | "error_kind" | "http_status" | "request_id">;

async function askClaude(db: TangentDB, questionId: string, client: Client | null, model: string): Promise<void> {
  const fail = (call: NewCall | null, kind: Kind) =>
    failAnswer(db, questionId, { call, reason: REASONS[kind] }).then(
      () => {},
      (error) => console.error("tangent: could not save the failure", error),
    );

  let request: Request;
  let articleId: string;
  try {
    const prompt = await promptFor(db, questionId);
    request = requestFor(prompt, model);
    articleId = prompt.article_id;
  } catch (error) {
    if (error instanceof Refused) return; // answered already: nothing to ask
    console.error("tangent: could not prepare the call", error);
    return fail(null, "unexpected");
  }
  if (!client) return fail(null, "no_key");

  const started = performance.now();
  const base = { model, request_json: storedRequest(request, articleId), started_at: nowISO(), prompt_version: PROMPT_VERSION };
  // When the answer's first text came: reset by a search, since the text before it is dropped.
  let firstToken: number | null = null;
  const callRow = (served: string | null, usage: Usage, outcome: Outcome): NewCall => ({
    ...base,
    finished_at: nowISO(),
    latency_ms: Math.round(performance.now() - started),
    first_token_ms: firstToken,
    ...counts(served ?? model, usage),
    served_model: served,
    ...outcome,
  });

  let stream: AnswerStream | undefined;
  const reply = replySaver(db, questionId, () => stream?.abort());
  // What the stream has said about itself, kept for a call cut off partway.
  let served: string | null = null;
  let usage = NO_USAGE;
  let message: BetaMessage;
  try {
    stream = client.beta.messages.stream(request);
    for await (const event of stream) {
      if (event.type === "message_start") {
        served = event.message.model;
        usage = event.message.usage;
      } else if (event.type === "message_delta") {
        usage = merged(usage, event.usage);
      } else if (event.type === "content_block_start" && isStep(event.content_block)) {
        reply.restart(); // what came before a search is not the answer
        firstToken = null;
      } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        firstToken ??= Math.round(performance.now() - started);
        reply.add(event.delta.text);
      }
    }
    message = await stream.finalMessage();
  } catch (error) {
    const kind = classify(error);
    if (kind === "unexpected") console.error("tangent: the call failed unexpectedly", error);
    await reply.flush(); // so the part kept as interrupted is all that arrived
    const api = error as { status?: number; requestID?: string | null; error?: unknown };
    return fail(
      callRow(served, usage, {
        response_json: api.error === undefined ? null : JSON.stringify(api.error),
        status: "error",
        stop_reason: null,
        error_kind: kind,
        http_status: api.status ?? null,
        request_id: api.requestID ?? stream?.request_id ?? null,
      }),
      kind,
    );
  }

  await reply.flush(); // so a declined reply keeps all that arrived
  const call = callRow(message.model, message.usage, {
    response_json: JSON.stringify(message),
    status: "ok",
    stop_reason: message.stop_reason,
    error_kind: null,
    http_status: 200,
    request_id: stream.request_id ?? null,
  });
  const { text, citations, searchFailed } = answerOf(message.content);
  if (message.stop_reason === "refusal" || !text) {
    const kind = message.stop_reason === "refusal" ? "refusal" : searchFailed ? "search_failed" : "empty";
    return fail({ ...call, status: "error", error_kind: kind }, kind);
  }
  // pause_turn: Anthropic's own search loop stopped before Claude finished.
  const truncated = message.stop_reason === "max_tokens" || message.stop_reason === "model_context_window_exceeded" || message.stop_reason === "pause_turn";
  await finishAnswer(db, questionId, { call, text, truncated, citations }).catch((error) => console.error("tangent: could not save the answer", error));
}

/** Saves the reply as it arrives: at most every STREAM_SAVE_MS, one save after another, and the
 *  latest text soon after it arrives even when no more follows. restart drops what came so far, as
 *  when a search starts. If the store refuses a save (the question was marked interrupted under this
 *  tab), lost is called once, to stop paying for a reply that can no longer be kept. */
function replySaver(db: TangentDB, questionId: string, lost: () => void) {
  let text = "";
  let saved = "";
  let savedAt = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let refused = false;
  let chain = Promise.resolve();

  const queue = (work: () => Promise<unknown>) => {
    chain = chain.then(work).then(
      () => {},
      (error) => {
        if (refused) return;
        refused = true;
        console.error("tangent: could not save the reply so far", error);
        lost();
      },
    );
  };

  const save = () => {
    clearTimeout(timer);
    timer = undefined;
    if (refused || !text.trim() || text === saved) return;
    savedAt = performance.now();
    saved = text;
    const sofar = text;
    queue(() => streamAnswer(db, questionId, sofar));
  };

  return {
    add(piece: string) {
      text += piece;
      const wait = STREAM_SAVE_MS - (performance.now() - savedAt);
      if (wait <= 0) save();
      else timer ??= setTimeout(save, wait);
    },
    restart() {
      clearTimeout(timer);
      timer = undefined;
      text = "";
      if (refused || !saved) return;
      saved = "";
      queue(() => dropReply(db, questionId));
    },
    /** Saves what is left and waits for every save. */
    flush: () => (save(), chain),
  };
}

const NO_USAGE: Usage = { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null };

/** A message_delta's counts are cumulative, and a null means no news. */
const merged = (usage: Usage, delta: BetaMessageDeltaUsage): Usage => ({
  input_tokens: delta.input_tokens ?? usage.input_tokens,
  output_tokens: delta.output_tokens,
  cache_creation_input_tokens: delta.cache_creation_input_tokens ?? usage.cache_creation_input_tokens,
  cache_read_input_tokens: delta.cache_read_input_tokens ?? usage.cache_read_input_tokens,
  server_tool_use: delta.server_tool_use ?? usage.server_tool_use,
  // Only message_start says which cache the writes went to.
  cache_creation: usage.cache_creation,
});

function counts(model: string, usage: Usage) {
  return {
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_write_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_tokens: usage.cache_read_input_tokens ?? 0,
    web_search_requests: usage.server_tool_use?.web_search_requests ?? 0,
    ...cost(model, usage),
  };
}
