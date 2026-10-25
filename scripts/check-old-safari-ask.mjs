// Asks a "Look it up" question on the built page in an older Safari engine (docs/design.md, Look it
// up): Safari before 26 failed `for await` on a ReadableStream, and the SDK reads Anthropic's stream.
// Anthropic is answered here with a made-up stream, so no real call is made. Older WebKit comes
// from an older playwright-core, as in check-old-safari.mjs. Then, with a fresh build:
//   fnm exec --using=24 -- pnpm build && fnm exec --using=24 -- pnpm exec vite preview --port 5191 &
//   fnm exec --using=24 -- node scripts/check-old-safari-ask.mjs ~/pw-1.45/node_modules/playwright-core http://127.0.0.1:5191
import { createRequire } from "node:module";
const [core, base] = process.argv.slice(2);
const { webkit, devices } = createRequire(import.meta.url)(core);

const page1 = { url: "https://example.com/rivers", title: "How rivers cut rock" };
const usage = { input_tokens: 1200, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, server_tool_use: null };
const events = [
  { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage } },
  { type: "content_block_start", index: 0, content_block: { type: "server_tool_use", id: "srv_1", name: "web_search", input: {} } },
  { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"query":"canyons"}' } },
  { type: "content_block_stop", index: 0 },
  { type: "content_block_start", index: 1, content_block: { type: "web_search_tool_result", tool_use_id: "srv_1", content: [{ type: "web_search_result", ...page1, page_age: null, encrypted_content: "e" }] } },
  { type: "content_block_stop", index: 1 },
  { type: "content_block_start", index: 2, content_block: { type: "text", text: "", citations: [] } },
  { type: "content_block_delta", index: 2, delta: { type: "citations_delta", citation: { type: "web_search_result_location", ...page1, cited_text: "x", encrypted_index: "e" } } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Canyons grow slowly. " } },
  { type: "content_block_delta", index: 2, delta: { type: "text_delta", text: "Floods move the most rock." } },
  { type: "content_block_stop", index: 2 },
  { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 40, server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } } },
  { type: "message_stop" },
];
const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join("");

const browser = await webkit.launch();
const context = await browser.newContext({ ...devices["iPhone 13"] });
await context.addInitScript(() => sessionStorage.setItem("tangent-reader:anthropic-key", "sk-ant-api03-made-up-WXYZ"));
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.route("https://api.anthropic.com/**", (route) => {
  const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "request-id", "request-id": "req_old" };
  if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
  return route.fulfill({ status: 200, headers: { ...cors, "content-type": "text/event-stream" }, body: sse });
});
let failed = false;
const expect = (ok, what) => (console.log(`${ok ? "ok  " : "FAIL"} ${what}`), (failed ||= !ok));

await page.goto(`${base}/`);
await page.getByRole("textbox", { name: "Article" }).fill("Rivers carve canyons over millions of years.\n\nThe Colorado River cut the Grand Canyon.");
await page.getByRole("button", { name: "Start reading" }).click();
await page.locator('[data-sentence="article|p0:s0"]').click();
const sheet = page.getByRole("complementary", { name: "Thread" });
await sheet.getByRole("button", { name: "Look it up" }).click();
await sheet.getByRole("textbox", { name: "Your question" }).fill("How fast?");
await sheet.getByRole("button", { name: "Ask", exact: true }).click();
const link = sheet.getByRole("link", { name: "How rivers cut rock" });
const got = await link.waitFor({ timeout: 15_000 }).then(() => true, () => false);
expect(got, "the answer arrived with its source");
expect(await sheet.getByRole("button", { name: "Floods move the most rock." }).isVisible(), "the answer splits into sentences");
expect(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
console.log(`WebKit ${browser.version()}`);
await browser.close();
process.exit(failed ? 1 : 0);
