import Anthropic from "@anthropic-ai/sdk";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TangentDB } from "../store/schema";
import { ask, createSession, failAnswer, openAnchor, openStore, retry } from "../store/store";
import { ARTICLE, FIRST, freshDB, messagesIn } from "../store/testing";
import { exportAll } from "../store/transfer";
import { answer } from "./answer";
import { HAIKU, SONNET } from "./models";
import { PROMPT_VERSION } from "../tangent/context";
import { REASONS } from "./reasons";
import { rebuildRequest } from "./request";
import { cited, fakeClient, searched, searchFailed, sseOf, text, thinking, type Script } from "./testing";

// Asking Claude from the tab, with a made-up Claude (testing.ts). No test calls the API.

let factory: IDBFactory;
let db: TangentDB;
let thread_id: string;
let question_id: string;

beforeEach(async () => {
  factory = new IDBFactory();
  db = freshDB(factory);
  const { session_id } = await createSession(db, { text: ARTICLE });
  thread_id = (await openAnchor(db, session_id, "p0:s0", FIRST)).thread_id;
  question_id = (await ask(db, thread_id, "Why so slow?")).message_id;
});

afterEach(() => {
  db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const inThread = () => messagesIn(db, thread_id);
const theCall = async () => (await db.calls.toArray())[0];
const PIECES = ["Water carries grit ", "that grinds the rock. ", "Floods do most of the work."];

describe("an answer", () => {
  it("is saved with its call, priced, and the question done", async () => {
    await answer(db, question_id, fakeClient({ pieces: PIECES, input_tokens: 1000, output_tokens: 500, cache_write_tokens: 10_000 }), SONNET);
    const [q, a] = await inThread();
    expect(q).toMatchObject({ status: "done", error: null });
    expect(a).toMatchObject({ role: "assistant", status: "done", text: PIECES.join("").trim(), truncated: false, call_id: (await theCall()).id });
    expect(await theCall()).toMatchObject({
      status: "ok",
      model: SONNET,
      served_model: SONNET,
      stop_reason: "end_turn",
      http_status: 200,
      request_id: "req_fake",
      input_tokens: 1000,
      output_tokens: 500,
      cache_write_tokens: 10_000,
      cost_usd: 0.032,
      web_search_cost_usd: null,
    });
  });

  it("is priced with its 1-hour cache writes, which only the stream's start reports", async () => {
    // 8k × $4 + 2k × $2.50 for the writes, 1k × $2 + 500 × $10, per million
    await answer(db, question_id, fakeClient({ pieces: PIECES, input_tokens: 1000, output_tokens: 500, cache_write_tokens: 10_000, cache_write_1h_tokens: 8_000 }), SONNET);
    expect(await theCall()).toMatchObject({ cache_write_tokens: 10_000, cost_usd: 0.044 });
  });

  it("is saved as it arrives, at most every few hundred ms", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const texts: string[] = [];
    const seen = async () => texts.push((await inThread())[1]?.text ?? "");
    const settle = () => new Promise((r) => setTimeout(r, 20));
    const before = async (piece: number) => {
      await settle();
      await seen();
      clock = [0, 100, 400][piece];
    };
    await answer(db, question_id, fakeClient({ pieces: PIECES, before }), SONNET);
    // Before piece 1 the first is saved; at 100 ms the second waits; at 400 ms both are saved.
    expect(texts).toEqual(["", PIECES[0], PIECES[0]]);
    expect((await inThread())[1].text).toBe(PIECES.join("").trim());
  });

  it("saves its latest text soon after it arrives, even when no more follows for a while", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const before = async (piece: number) => {
      if (piece === 1) clock = 100; // the second piece comes too soon to save at once
      if (piece === 2) await vi.waitFor(async () => expect((await inThread())[1].text).toBe(PIECES[0] + PIECES[1]));
    };
    await answer(db, question_id, fakeClient({ pieces: PIECES, before }), SONNET);
  });

  it.each(["max_tokens", "model_context_window_exceeded"] as const)("cut off by %s is saved and marked", async (stop_reason) => {
    await answer(db, question_id, fakeClient({ pieces: PIECES, stop_reason }), SONNET);
    expect((await inThread())[1]).toMatchObject({ status: "done", truncated: true });
  });

  it("asks Haiku with no fallback, and prices it at Haiku's rates", async () => {
    const client = fakeClient({ pieces: PIECES, model: HAIKU, input_tokens: 1000, output_tokens: 500, cache_write_tokens: 10_000 });
    await answer(db, question_id, client, HAIKU);
    expect(client.sent[0]).not.toHaveProperty("fallbacks");
    expect((await theCall()).cost_usd).toBe(0.0016);
  });
});

describe("asking once", () => {
  it("a second answer for the same question, as from a double tap, does nothing", async () => {
    const client = fakeClient({ pieces: PIECES });
    await Promise.all([answer(db, question_id, client, SONNET), answer(db, question_id, client, SONNET)]);
    expect(client.sent).toHaveLength(1);
    expect((await inThread()).map((m) => m.status)).toEqual(["done", "done"]);
  });

  it("a question already answered is never asked again", async () => {
    await answer(db, question_id, fakeClient({ pieces: PIECES }), SONNET);
    const again = fakeClient({ pieces: PIECES });
    await answer(db, question_id, again, SONNET);
    expect(again.sent).toHaveLength(0);
    expect(await db.calls.count()).toBe(1);
  });

  it("stops the call when its reply can no longer be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => (clock += 1000)); // every piece is saved at once
    const client = fakeClient({
      pieces: PIECES,
      before: async (piece) => {
        // Another tab, with no Web Locks to stop it, marks the question failed mid-reply.
        if (piece === 1) await failAnswer(db, question_id, { call: null, reason: "The tab closed before the answer finished. Ask again." });
        if (piece === 2) await vi.waitFor(() => expect(client.streams[0].aborted).toBe(true));
      },
    });
    await answer(db, question_id, client, SONNET);
    expect(client.streams[0].aborted).toBe(true);
    expect((await inThread())[0]).toMatchObject({ status: "failed", error: "The tab closed before the answer finished. Ask again." });
  });

  it("works on a page with no Web Locks, which browsers give only to secure pages", async () => {
    vi.stubGlobal("navigator", {});
    await answer(db, question_id, fakeClient({ pieces: PIECES }), SONNET);
    expect((await inThread()).map((m) => m.status)).toEqual(["done", "done"]);
    expect(await openStore(freshDB(factory))).toBe(0);
  });
});

describe("the call log", () => {
  it("rebuilds exactly what was sent once the article is put back (rule 5)", async () => {
    const client = fakeClient({ pieces: PIECES });
    await answer(db, question_id, client, SONNET);
    const call = await theCall();
    expect(call.request_json).not.toContain(ARTICLE);
    expect(JSON.stringify(rebuildRequest(call.request_json, ARTICLE))).toBe(JSON.stringify(client.sent[0]));
  });

  it("never holds the key: it goes only in the header to Anthropic", async () => {
    const KEY = "sk-ant-api03-made-up-for-tests-WXYZ";
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => new Response(sseOf({ pieces: PIECES }), { headers: { "content-type": "text/event-stream", "request-id": "req_wire" } }));
    const client = new Anthropic({ apiKey: KEY, dangerouslyAllowBrowser: true, fetch, maxRetries: 0 });
    await answer(db, question_id, client, SONNET);

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.anthropic.com/v1/messages?beta=true");
    const headers = new Headers(init!.headers);
    expect(headers.get("x-api-key")).toBe(KEY);
    expect(headers.get("anthropic-beta")).toBe("server-side-fallback-2026-07-01");
    const call = await theCall();
    const { betas: _, ...body } = rebuildRequest(call.request_json, ARTICLE) as Record<string, unknown>;
    expect(JSON.parse(String(init!.body))).toEqual({ ...body, stream: true });
    expect(call.request_id).toBe("req_wire");
    expect(JSON.stringify(await exportAll(db))).not.toContain(KEY);
  });
});

describe("an answer that looked it up", () => {
  const RIVERS = { url: "https://example.com/rivers", title: "How rivers cut rock" };
  const FLOODS = { url: "https://example.org/floods", title: "Floods and canyons" };
  const lookItUp = () => db.messages.update(question_id, { search: true });

  it("sends the search tool, and is saved with its sources and its searches priced", async () => {
    await lookItUp();
    const blocks = [thinking(), ...searched("canyon erosion", [RIVERS, FLOODS]), thinking(), text("Canyons grow "), cited("about a millimetre a year.", RIVERS), text(" "), cited("Floods move the most rock.", FLOODS)];
    const client = fakeClient({ blocks, searches: 2 });
    await answer(db, question_id, client, SONNET);
    expect(client.sent[0].tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
    const [q, a] = await inThread();
    expect(q.status).toBe("done");
    expect(a).toMatchObject({ status: "done", text: "Canyons grow about a millimetre a year. Floods move the most rock.", citations: [RIVERS, FLOODS] });
    // 1200 in, 300 out and 5000 written at Sonnet's rates, plus two searches at 1 cent.
    expect(await theCall()).toMatchObject({ web_search_requests: 2, web_search_cost_usd: 0.02, cost_usd: 0.0379 });
  });

  it("drops text written before a search, and streams the answer after it", async () => {
    await lookItUp();
    const seen: string[][] = [];
    const before = async () => {
      await new Promise((r) => setTimeout(r, 20));
      seen.push((await inThread()).slice(1).map((m) => m.text));
    };
    await answer(db, question_id, fakeClient({ blocks: [text("Let me "), text("look that up."), ...searched("canyons", [RIVERS]), cited("Slowly.", RIVERS)], searches: 1, before }), SONNET);
    // Before each delta: nothing yet; the first text saved; then the search started, so it is gone.
    expect(seen).toEqual([[], ["Let me "], [], [], []]);
    expect((await inThread())[1]).toMatchObject({ status: "done", text: "Slowly.", citations: [RIVERS] });
  });

  it("whose search failed with no answer after it fails and says so, and asking again searches again", async () => {
    await lookItUp();
    await answer(db, question_id, fakeClient({ blocks: searchFailed("canyons", "unavailable"), searches: 0 }), SONNET);
    expect(await inThread()).toMatchObject([{ status: "failed", error: REASONS.search_failed }]);
    expect(await theCall()).toMatchObject({ status: "error", error_kind: "search_failed" });

    await retry(db, question_id);
    const client = fakeClient({ blocks: [...searched("canyons", [RIVERS]), cited("Slowly.", RIVERS)], searches: 1 });
    await answer(db, question_id, client, SONNET);
    expect(client.sent[0].tools).toHaveLength(1);
    expect((await inThread()).map((m) => m.status)).toEqual(["done", "done"]);
  });

  it("paused by Anthropic's search loop is kept, marked cut off", async () => {
    await lookItUp();
    await answer(db, question_id, fakeClient({ blocks: [...searched("canyons", [RIVERS]), cited("Slowly.", RIVERS)], searches: 1, stop_reason: "pause_turn" }), SONNET);
    expect((await inThread())[1]).toMatchObject({ status: "done", text: "Slowly.", truncated: true });
  });
});

describe("the call log, for the evals", () => {
  // The clock moves to the time given for each delta, just before it arrives.
  const clocked = (times: number[]) => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    return (piece: number) => void (clock = times[piece]);
  };

  it("keeps when the first text arrived, and which prompt asked", async () => {
    const before = clocked([120, 300, 500]);
    await answer(db, question_id, fakeClient({ pieces: PIECES, before }), SONNET);
    expect(await theCall()).toMatchObject({ first_token_ms: 120, latency_ms: 500, prompt_version: PROMPT_VERSION });
  });

  it("counts the wait from the answer after a search, since text before it is dropped", async () => {
    await db.messages.update(question_id, { search: true });
    const page = { url: "https://example.com/rivers", title: "How rivers cut rock" };
    // Deltas: "Let me ", the search's query, the citation, then "Slowly."
    const before = clocked([100, 200, 300, 450]);
    await answer(db, question_id, fakeClient({ blocks: [text("Let me "), ...searched("canyons", [page]), cited("Slowly.", page)], searches: 1, before }), SONNET);
    expect(await theCall()).toMatchObject({ first_token_ms: 450 });
  });

  it("has no first text for a call that failed before any arrived", async () => {
    await answer(db, question_id, fakeClient({ pieces: PIECES, error: { at: 0, error: new Anthropic.APIConnectionError({ message: "network error" }) } }), SONNET);
    expect(await theCall()).toMatchObject({ status: "error", first_token_ms: null, prompt_version: PROMPT_VERSION });
  });
});

describe("a failed answer", () => {
  const failsWith = async (script: Script) => {
    await answer(db, question_id, fakeClient(script), SONNET);
    return { messages: await inThread(), call: await theCall() };
  };

  it("declined by Claude keeps its call and says so, and the part that arrived is kept", async () => {
    const { messages, call } = await failsWith({ pieces: ["Water carries"], stop_reason: "refusal" });
    expect(messages.map((m) => m.status)).toEqual(["failed", "interrupted"]);
    expect(messages[0].error).toBe(REASONS.refusal);
    expect(call).toMatchObject({ status: "error", error_kind: "refusal", output_tokens: 300 });
  });

  it("that came back empty keeps its call and says so", async () => {
    const { messages, call } = await failsWith({ pieces: [] });
    expect(messages).toMatchObject([{ status: "failed", error: REASONS.empty }]);
    expect(call).toMatchObject({ status: "error", error_kind: "empty" });
  });

  it("cut off partway keeps what arrived as interrupted, and the tokens seen so far", async () => {
    const lost = new Anthropic.APIConnectionError({ message: "network error" });
    const { messages, call } = await failsWith({ pieces: PIECES, error: { at: 4, error: lost } }); // after two pieces
    expect(messages).toMatchObject([
      { status: "failed", error: REASONS.unreachable },
      { status: "interrupted", text: PIECES[0] + PIECES[1], call_id: call.id },
    ]);
    expect(call).toMatchObject({ status: "error", error_kind: "unreachable", served_model: SONNET, input_tokens: 1200, output_tokens: 1, cost_usd: expect.any(Number) });
  });

  it("with no key saves no call", async () => {
    await answer(db, question_id, null, SONNET);
    expect(await inThread()).toMatchObject([{ status: "failed", error: REASONS.no_key }]);
    expect(await db.calls.count()).toBe(0);
  });

  const headers = new Headers({ "request-id": "req_err" });
  const body = (type: string, message: string) => ({ type: "error", error: { type, message } });
  it.each([
    ["auth", new Anthropic.AuthenticationError(401, body("authentication_error", "invalid x-api-key"), undefined, headers), 401],
    ["permission", new Anthropic.PermissionDeniedError(403, body("permission_error", "no"), undefined, headers), 403],
    ["no_credit", Anthropic.APIError.generate(402, body("billing_error", "pay"), undefined, headers), 402],
    ["no_credit", new Anthropic.BadRequestError(400, body("invalid_request_error", "Your credit balance is too low"), undefined, headers), 400],
    ["bad_request", new Anthropic.BadRequestError(400, body("invalid_request_error", "messages: bad"), undefined, headers), 400],
    ["too_large", Anthropic.APIError.generate(413, body("request_too_large", "big"), undefined, headers), 413],
    ["rate_limited", new Anthropic.RateLimitError(429, body("rate_limit_error", "slow down"), undefined, headers), 429],
    ["overloaded", Anthropic.APIError.generate(529, body("overloaded_error", "busy"), undefined, headers), 529],
    ["overloaded", new Anthropic.APIError(undefined, body("overloaded_error", "busy"), undefined, undefined, "overloaded_error"), null], // mid-stream
    ["rate_limited", new Anthropic.APIError(undefined, body("rate_limit_error", "slow down"), undefined, undefined, "rate_limit_error"), null], // mid-stream
    ["api_error", new Anthropic.InternalServerError(500, body("api_error", "oops"), undefined, headers), 500],
    ["unreachable", new Anthropic.APIConnectionError({ message: "fetch failed" }), null],
    ["unexpected", new TypeError("boom"), null],
  ] as const)("says why in our words: %s", async (kind, error, status) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { messages, call } = await failsWith({ pieces: PIECES, error: { at: 0, error } });
    expect(messages).toMatchObject([{ status: "failed", error: REASONS[kind] }]);
    expect(call).toMatchObject({ status: "error", error_kind: kind, http_status: status, input_tokens: 0, cost_usd: 0 });
    expect(call.request_id).toBe(status ? "req_err" : "req_fake");
  });
});

describe("two tabs", () => {
  it("a tab opening the store mid-answer leaves it alone, and the answer is saved", async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const asking = answer(db, question_id, fakeClient({ pieces: PIECES, before: (p) => (p === 1 ? held : undefined) }), SONNET);
    await vi.waitFor(async () => expect((await inThread())[1]?.status).toBe("streaming"));

    const other = freshDB(factory);
    expect(await openStore(other)).toBe(0);
    other.close();
    release();
    await asking;
    expect((await inThread()).map((m) => m.status)).toEqual(["done", "done"]);
  });
});
