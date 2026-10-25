// The models you can ask, and what each one costs (docs/design.md, Asking Claude). Checked against
// Anthropic's pricing page on 2026-10-12. A call is priced when it is made, so changing a price here
// never rewrites one already saved.

/** $ per million tokens. The article is cached for an hour (CACHE_TTL); cacheWrite is the 5-minute
 *  cache, which web search still writes on its own. */
export interface Rates {
  input: number;
  output: number;
  cacheWrite: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface Model {
  id: string;
  /** What Settings calls it. */
  label: string;
  rates: Rates;
  /** Some models cost more for a long prompt: over this many tokens, counting cached ones, the
   *  whole call is priced at these rates. */
  longPrompt?: { over: number; rates: Rates };
  /** Whether a declined question is asked again on Anthropic's recommended model, in the same
   *  call. Haiku has no such fallback. */
  fallback: boolean;
}

export const SONNET = "claude-sonnet-5-5";
export const HAIKU = "claude-haiku-5-5";

/** The models Settings offers, the default first. */
export const MODELS: Model[] = [
  { id: SONNET, label: "Sonnet 5.5", rates: { input: 2, output: 10, cacheWrite: 2.5, cacheWrite1h: 4, cacheRead: 0.1 }, fallback: true },
  {
    id: HAIKU,
    label: "Haiku 5.5 (cheaper)",
    rates: { input: 0.1, output: 0.5, cacheWrite: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01 },
    longPrompt: { over: 100_000, rates: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheWrite1h: 1, cacheRead: 0.05 } },
    fallback: false,
  },
];

export const DEFAULT_MODEL = SONNET;

/** Models that may answer in place of one you chose: Sonnet 5.5 falls back to Sonnet 5. */
const FALLBACK_MODELS: Pick<Model, "id" | "rates">[] = [
  { id: "claude-sonnet-5", rates: { input: 2, output: 10, cacheWrite: 2.5, cacheWrite1h: 4, cacheRead: 0.2 } },
];

/** What a model costs, by the id that answered. Undefined for one this page does not know. */
export function ratesFor(id: string): Pick<Model, "rates" | "longPrompt"> | undefined {
  return MODELS.find((m) => m.id === id) ?? FALLBACK_MODELS.find((m) => m.id === id);
}

/** How long the article stays cached. A reader pauses: one pause over 5 minutes in an hour already
 *  costs more on the 5-minute cache, which pays the write again (docs/design.md, Asking Claude). */
export const CACHE_TTL = "1h";

/** CACHE_TTL in ms, counted from the start of the last call that read or wrote it. */
export const CACHE_TTL_MS = 60 * 60 * 1000;

/** $ per web search ($10 per 1,000), on top of tokens. */
export const WEB_SEARCH_USD = 0.01;

/** "Look it up": Anthropic's web search, run on its servers. The basic version on both models.
 *  The newer one (web_search_20260209) has Sonnet read results through code, and its answer then
 *  cites no sources (recorded 2026-10-14). */
export const SEARCH_TOOL = "web_search_20250305";

/** About what one search's pages add to the prompt, in tokens (Sonnet 5.5, recorded 2026-10-14). */
export const SEARCH_PAGE_TOKENS = 12_000;

/** The most searches one answer may make. */
export const MAX_SEARCHES = 3;

/** Conversation, not hard reasoning: low effort keeps answers quick and cheap. Thinking cannot be
 *  turned off on these models and it counts toward MAX_TOKENS. */
export const EFFORT = "low";

/** Room for the thinking and a long answer. An answer that reaches it is saved and marked cut off,
 *  so it also caps what one answer can cost. */
export const MAX_TOKENS = 8192;

/** On a decline, the API asks again on the model Anthropic recommends, in the same call. */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** How long to wait for Anthropic to start answering, in ms. */
export const TIMEOUT_MS = 120_000;
