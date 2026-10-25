import type { BetaMessageStreamParams } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Prompt } from "../store/reads";
import { todayISO } from "../shell/dates";
import { articleBlock, messages, systemBlocks } from "../tangent/context";
import { EFFORT, FALLBACK_BETA, MAX_SEARCHES, MAX_TOKENS, MODELS, SEARCH_TOOL } from "./models";

// The request for one question, and how it is saved in the call log (docs/design.md, Data and
// Asking Claude). It is the exact arguments given to the SDK. betas becomes a header on the way
// out; the key is never in here, and the store refuses a request that carries one.

const ARTICLE_REF = "article_ref";

/** With "Look it up" on, the search tool goes in, and today's date after the cached blocks:
 *  Anthropic advises giving it with any search tool, so answers lean on recent results. */
export function requestFor(prompt: Prompt, model: string, today = todayISO()) {
  const fallback = MODELS.find((m) => m.id === model)?.fallback ?? false;
  const system = systemBlocks(prompt.article, prompt.path);
  return {
    model,
    max_tokens: MAX_TOKENS,
    output_config: { effort: EFFORT },
    ...(fallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    system: prompt.search ? [...system, { type: "text" as const, text: `The current date is ${today}.` }] : system,
    ...(prompt.search ? { tools: [{ type: SEARCH_TOOL, name: "web_search" as const, max_uses: MAX_SEARCHES }] } : {}),
    messages: messages(prompt.turns),
  } satisfies BetaMessageStreamParams;
}

export type Request = ReturnType<typeof requestFor>;

/** The request as saved: the article's text, block 0 of system, swapped for its id. */
export function storedRequest(request: Request, articleId: string): string {
  const [article, ...rest] = request.system;
  return JSON.stringify({ ...request, system: [{ ...article, text: { [ARTICLE_REF]: articleId } }, ...rest] });
}

/** The exact request back from what was saved (rule 5). */
export function rebuildRequest(requestJson: string, articleText: string): Request {
  const request = JSON.parse(requestJson);
  request.system[0].text = articleBlock(articleText).text;
  return request;
}
