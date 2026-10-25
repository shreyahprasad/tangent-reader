import type { BetaUsage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { ratesFor, WEB_SEARCH_USD } from "./models";

// What a call cost, priced at the model that answered (docs/design.md, Data). A call that fell
// back to another model is priced whole at that model's rates.

export type Usage = Pick<BetaUsage, "input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens" | "server_tool_use"> &
  Partial<Pick<BetaUsage, "cache_creation">>;

const round = (usd: number) => Math.round(usd * 1_000_000) / 1_000_000;

/** cost_usd is the whole call, searches included, or null for a model with no known price. */
export function cost(model: string, usage: Usage): { cost_usd: number | null; web_search_cost_usd: number | null } {
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const web_search_cost_usd = searches ? round(searches * WEB_SEARCH_USD) : null;
  const known = ratesFor(model);
  if (!known) return { cost_usd: null, web_search_cost_usd };

  const write = usage.cache_creation_input_tokens ?? 0;
  // Writes the usage does not place in the 1-hour cache are priced as 5-minute ones.
  const writeHour = Math.min(usage.cache_creation?.ephemeral_1h_input_tokens ?? 0, write);
  const read = usage.cache_read_input_tokens ?? 0;
  const prompt = usage.input_tokens + write + read;
  const r = known.longPrompt && prompt > known.longPrompt.over ? known.longPrompt.rates : known.rates;
  const tokens = usage.input_tokens * r.input + usage.output_tokens * r.output + (write - writeHour) * r.cacheWrite + writeHour * r.cacheWrite1h + read * r.cacheRead;
  return { cost_usd: round(tokens / 1_000_000 + searches * WEB_SEARCH_USD), web_search_cost_usd };
}
