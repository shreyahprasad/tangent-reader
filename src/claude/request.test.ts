import { describe, expect, it } from "vitest";
import type { Prompt } from "../store/reads";
import { articleBlock } from "../tangent/context";
import { HAIKU, SONNET } from "./models";
import { rebuildRequest, requestFor, storedRequest } from "./request";

const TODAY = "2026-10-14";

const ARTICLE_ID = "a".repeat(64);
const prompt: Prompt = {
  session_id: crypto.randomUUID(),
  thread_id: crypto.randomUUID(),
  article_id: ARTICLE_ID,
  article: "Rivers carve canyons. Slowly.",
  path: ["Rivers carve canyons."],
  turns: [["user", "How?"]],
  search: false,
};

describe("the request", () => {
  it("asks at low effort with the cached article first, and falls back on a decline", () => {
    const request = requestFor(prompt, SONNET);
    expect(request).toMatchObject({ model: SONNET, max_tokens: 8192, output_config: { effort: "low" }, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" });
    expect(request.system[0]).toEqual(articleBlock(prompt.article));
    expect(request.messages).toEqual([{ role: "user", content: "How?" }]);
  });

  it("sends no fallback for a model that has none", () => {
    const request = requestFor(prompt, HAIKU);
    expect("fallbacks" in request || "betas" in request).toBe(false);
  });

  it("is saved with the article swapped for its id, and rebuilds exactly (rule 5)", () => {
    const request = requestFor(prompt, SONNET);
    const saved = storedRequest(request, ARTICLE_ID);
    expect(saved).not.toContain(prompt.article);
    expect(JSON.parse(saved).system[0].text).toEqual({ article_ref: ARTICLE_ID });
    expect(JSON.stringify(rebuildRequest(saved, prompt.article))).toBe(JSON.stringify(request));
  });

  it("sends no tools when Look it up is off", () => {
    expect("tools" in requestFor(prompt, SONNET, TODAY)).toBe(false);
    expect(requestFor(prompt, SONNET, TODAY).system).toHaveLength(2);
  });

  it.each([SONNET, HAIKU])("with Look it up on, %s gets the search tool and today's date after the cached blocks", (model) => {
    const plain = requestFor(prompt, model, TODAY);
    const request = requestFor({ ...prompt, search: true }, model, TODAY);
    expect(request.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
    expect(request.system.slice(0, 2)).toEqual(plain.system);
    expect(request.system[2]).toEqual({ type: "text", text: "The current date is 2026-10-14." });
  });

  it("with Look it up on, is saved and rebuilds exactly (rule 5)", () => {
    const request = requestFor({ ...prompt, search: true }, SONNET, TODAY);
    expect(JSON.stringify(rebuildRequest(storedRequest(request, ARTICLE_ID), prompt.article))).toBe(JSON.stringify(request));
  });
});
