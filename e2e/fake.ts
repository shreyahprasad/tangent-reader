import type { Page, Route } from "@playwright/test";
import { sseOf, type Script } from "../src/claude/testing";
import type { Ids, Seed } from "./seed";

// The page's data and Claude, faked. A session is saved through the app's own store by seed.ts,
// run in the page; Anthropic is answered here, so no test ever calls the real API.

type SeedModule = typeof import("./seed");
const SEED = "/e2e/seed.ts";

/** Opens the app, saves the made-up session, and returns its ids. */
export async function seeded(page: Page, options: Seed = {}): Promise<Ids> {
  await page.goto("/");
  return page.evaluate(async ([path, options]) => ((await import(/* @vite-ignore */ path)) as SeedModule).seed(options), [SEED, options] as const);
}

/** The visits saved for a session, oldest first. */
export const visitsOf = (page: Page, sessionId: string) =>
  page.evaluate(async ([path, id]) => ((await import(/* @vite-ignore */ path)) as SeedModule).visitsOf(id), [SEED, sessionId] as const);

/** A made-up key, kept in the tab as if checked and saved. */
export const KEY = "sk-ant-api03-made-up-for-e2e-WXYZ";

export async function withKey(page: Page) {
  await page.addInitScript((key) => sessionStorage.setItem("tangent-reader:anthropic-key", key), KEY);
}

/** The Anthropic API: the key check passes, and each question is answered by the next reply
 *  given, or the last one again. A reply can be held: it waits for release(). Returns the request
 *  bodies sent. */
export async function fakeClaude(page: Page, ...replies: Reply[]) {
  const sent: unknown[] = [];
  await page.route("https://api.anthropic.com/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/v1/models") return route.fulfill({ json: { data: [{ id: "claude-sonnet-5-5", type: "model" }], has_more: false } });
    if (url.pathname !== "/v1/messages") return route.fulfill({ status: 404, json: { type: "error", error: { type: "not_found_error", message: "not in the fake" } } });
    sent.push(route.request().postDataJSON());
    const reply = replies[Math.min(sent.length, replies.length) - 1];
    await reply.held;
    return answer(route, reply);
  });
  return sent;
}

export interface Reply {
  script?: Script;
  /** The stream stops after this many pieces, as when the connection drops mid-reply. */
  cutAfter?: number;
  /** An API error in place of the reply. Never retried by the SDK. */
  error?: { status: number; type: string };
  held?: Promise<void>;
}

/** A reply that waits until release() is called. */
export function held(reply: Omit<Reply, "held">): Reply & { release: () => void } {
  let release = () => {};
  const waiting = new Promise<void>((resolve) => (release = resolve));
  return { ...reply, held: waiting, release };
}

/** A reply that never comes, as when the tab closes mid-call. */
export const never = (): Reply => ({ held: new Promise(() => {}) });

function answer(route: Route, { script, error, cutAfter }: Reply) {
  // The browser lets the SDK read only the headers CORS exposes, as Anthropic's API does.
  const headers = { "access-control-allow-origin": "*", "access-control-expose-headers": "request-id, x-should-retry", "request-id": "req_e2e", "x-should-retry": "false" };
  if (error) return route.fulfill({ status: error.status, headers, json: { type: "error", error: { type: error.type, message: "made up" } } });
  let body = sseOf(script ?? {});
  if (cutAfter !== undefined) body = body.split("\n\n").slice(0, 2 + cutAfter).join("\n\n") + "\n\n"; // the start, its block, and the pieces
  return route.fulfill({ status: 200, headers: { ...headers, "content-type": "text/event-stream" }, body });
}

/** A file to pick: its text, its bytes, or a fixture the dev server serves (/e2e/fixtures/...). */
export type PickedFile = { name: string; type?: string } & ({ text: string } | { bytes: number[] } | { url: string });

/** Picks a file in the import card's file input, as the picker would. Built in the page, so a test
 *  needs no file on disk and no Node types. */
export async function pickFile(page: Page, file: PickedFile) {
  await page.locator('input[type="file"]').evaluate(async (input: HTMLInputElement, f) => {
    const body = "text" in f ? f.text : "bytes" in f ? new Uint8Array(f.bytes) : await (await fetch(f.url)).arrayBuffer();
    const picked = new DataTransfer();
    picked.items.add(new File([body], f.name, { type: f.type ?? "" }));
    input.files = picked.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, file);
}

/** What the Worker's /fetch answers: a page's HTML, a PDF from the fixtures, or a failure. */
export type Fetched = { html: string; url?: string } | { pdf: string; url: string } | { failure: { error: string; [k: string]: unknown }; status: number };

/** The Worker's /fetch, faked: each link asked for gets the answer given for it. Returns the links
 *  asked for, so a test can see what was (and was not) fetched. */
export async function fakeFetch(page: Page, answers: Record<string, Fetched>) {
  const asked: string[] = [];
  await page.route("**/fetch", async (route) => {
    const { url } = route.request().postDataJSON() as { url: string };
    asked.push(url);
    const answer = answers[url];
    if (!answer) return route.fulfill({ status: 502, json: { error: "unreachable" } });
    if ("failure" in answer) return route.fulfill({ status: answer.status, json: answer.failure });
    if ("pdf" in answer) return route.fulfill({ path: answer.pdf, headers: { "content-type": "application/pdf", "x-final-url": answer.url } });
    return route.fulfill({ json: { html: answer.html, url: answer.url ?? url } });
  });
  return asked;
}
