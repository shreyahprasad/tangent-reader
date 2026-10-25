import Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessage, BetaRawMessageStreamEvent, BetaStopReason, BetaWebSearchToolResultErrorCode } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AnswerStream, Client } from "./answer";
import { SONNET } from "./models";
import type { Request } from "./request";

// For tests only: a made-up Claude that streams what it is told to. No test ever calls the API.

export interface Script {
  /** The reply, piece by piece. */
  pieces?: string[];
  /** The reply as whole blocks, for one that searched. Used in place of pieces. */
  blocks?: BetaContentBlock[];
  /** How many searches the usage counts. */
  searches?: number;
  stop_reason?: BetaStopReason;
  /** The model that answered. */
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_write_tokens?: number;
  /** How many of the cache writes went to the 1-hour cache. The rest are 5-minute ones. */
  cache_write_1h_tokens?: number;
  cache_read_tokens?: number;
  /** Thrown in place of the event at this place in the stream: 0 is before anything arrives. */
  error?: { at: number; error: unknown };
  /** Awaited before each piece is sent, with its place among the pieces. */
  before?: (piece: number) => Promise<void> | void;
}

/** The whole reply, as the API sends it at the end. */
export function finalOf(script: Script): BetaMessage {
  const { pieces = [], stop_reason = "end_turn", model = SONNET, cache_write_tokens = 5000, cache_write_1h_tokens = 0 } = script;
  const text = pieces.join("");
  const content = script.blocks ?? (text ? [{ type: "text", text, citations: null }] : []);
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason,
    stop_sequence: null,
    usage: {
      input_tokens: script.input_tokens ?? 1200,
      output_tokens: script.output_tokens ?? 300,
      cache_creation_input_tokens: cache_write_tokens,
      cache_creation: { ephemeral_1h_input_tokens: cache_write_1h_tokens, ephemeral_5m_input_tokens: cache_write_tokens - cache_write_1h_tokens },
      cache_read_input_tokens: script.cache_read_tokens ?? 0,
      server_tool_use: script.searches ? { web_search_requests: script.searches, web_fetch_requests: 0 } : null,
    },
  } as BetaMessage;
}

/** The reply as stream events, in order. Searches are counted at the end, as the API does. */
export function eventsOf(script: Script): BetaRawMessageStreamEvent[] {
  const final = finalOf(script);
  const start = { ...final, content: [], stop_reason: null, usage: { ...final.usage, output_tokens: 1, server_tool_use: null } };
  const blocks = script.blocks
    ? script.blocks.flatMap(blockEvents)
    : [
        { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } },
        ...(script.pieces ?? []).map((text) => ({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } })),
        { type: "content_block_stop", index: 0 },
      ];
  return [
    { type: "message_start", message: start },
    ...blocks,
    {
      type: "message_delta",
      delta: { stop_reason: final.stop_reason, stop_sequence: null },
      usage: { output_tokens: final.usage.output_tokens, server_tool_use: final.usage.server_tool_use },
    },
    { type: "message_stop" },
  ] as BetaRawMessageStreamEvent[];
}

/** One block as the API streams it: text and its citations arrive as deltas, a search's query as
 *  JSON, and a search's results whole. */
function blockEvents(block: BetaContentBlock, index: number) {
  const delta = (d: object) => ({ type: "content_block_delta", index, delta: d });
  const shape =
    block.type === "text"
      ? { start: { type: "text", text: "", ...(block.citations ? { citations: [] } : {}) }, deltas: [...(block.citations ?? []).map((citation) => delta({ type: "citations_delta", citation })), delta({ type: "text_delta", text: block.text })] }
      : block.type === "server_tool_use"
        ? { start: { ...block, input: {} }, deltas: [delta({ type: "input_json_delta", partial_json: JSON.stringify(block.input) })] }
        : { start: block, deltas: [] };
  return [{ type: "content_block_start", index, content_block: shape.start }, ...shape.deltas, { type: "content_block_stop", index }];
}

// Blocks for a reply that searched, shaped like the ones recorded on 2026-10-14. Pages made up.

type Page = { url: string; title: string | null };

export const text = (text: string): BetaContentBlock => ({ type: "text", text, citations: null });

export const thinking = (): BetaContentBlock => ({ type: "thinking", thinking: "", signature: "sig" });

export const cited = (text: string, page: Page): BetaContentBlock => ({
  type: "text",
  text,
  citations: [{ type: "web_search_result_location", url: page.url, title: page.title, cited_text: text, encrypted_index: "enc" }],
});

let searchId = 0;

/** A search and its results. */
export function searched(query: string, pages: Page[]): BetaContentBlock[] {
  const id = `srvtoolu_${++searchId}`;
  return [
    { type: "server_tool_use", id, name: "web_search", input: { query } },
    {
      type: "web_search_tool_result",
      tool_use_id: id,
      content: pages.map((p) => ({ type: "web_search_result", url: p.url, title: p.title ?? "", page_age: "3 days ago", encrypted_content: "enc" })),
    },
  ] as BetaContentBlock[];
}

/** A search that came back as an error. */
export function searchFailed(query: string, error_code: BetaWebSearchToolResultErrorCode): BetaContentBlock[] {
  const id = `srvtoolu_${++searchId}`;
  return [
    { type: "server_tool_use", id, name: "web_search", input: { query } },
    { type: "web_search_tool_result", tool_use_id: id, content: { type: "web_search_tool_result_error", error_code } },
  ] as BetaContentBlock[];
}

export interface FakeStream extends AnswerStream {
  readonly aborted: boolean;
}

export function fakeStream(script: Script): FakeStream {
  const events = eventsOf(script);
  let aborted = false;
  return {
    request_id: "req_fake",
    get aborted() {
      return aborted;
    },
    abort: () => void (aborted = true),
    async *[Symbol.asyncIterator]() {
      let piece = 0;
      for (const [at, event] of events.entries()) {
        if (script.error?.at === at) throw script.error.error;
        if (event.type === "content_block_delta") await script.before?.(piece++);
        if (aborted) throw new Anthropic.APIUserAbortError();
        yield event;
      }
    },
    finalMessage: async () => finalOf(script),
  };
}

/** A client that answers with the script, and keeps every request it was sent and stream it made. */
export function fakeClient(script: Script): Client & { sent: Request[]; streams: FakeStream[] } {
  const sent: Request[] = [];
  const streams: FakeStream[] = [];
  return {
    sent,
    streams,
    beta: {
      messages: {
        stream: (body) => {
          sent.push(structuredClone(body));
          streams.push(fakeStream(script));
          return streams[streams.length - 1];
        },
      },
    },
  };
}

/** The reply as an SSE response body, the way api.anthropic.com sends it. */
export function sseOf(script: Script): string {
  return eventsOf(script)
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
}
