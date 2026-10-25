import { READ_IN_NOTE_FROM_USD, SPEND_WARN_AT } from "../tangent/style";
import { device, type Store } from "./choice";
import { CACHE_TTL_MS, ratesFor, SEARCH_PAGE_TOKENS, WEB_SEARCH_USD } from "./models";

// The spending guard (docs/design.md, Asking Claude). A soft one: your Console workspace's spend limit is
// the real cap. Here, a monthly limit you set in Settings, kept on this device, and what the next
// question will cost to read the article in when the cache has gone cold.

const NAME = "tangent-reader:limit";

/** Your monthly limit in dollars, or null for none. Anything else kept there reads as none. */
export function loadLimit(storage: Store | null = device()): number | null {
  try {
    const usd = Number(storage?.getItem(NAME) || NaN);
    return Number.isFinite(usd) && usd > 0 ? usd : null;
  } catch {
    return null;
  }
}

/** Throws when this browser will not keep site data. */
export function saveLimit(usd: number, storage: Store | null = device()): void {
  storage?.setItem(NAME, String(usd));
}

export function forgetLimit(storage: Store | null = device()): void {
  storage?.removeItem(NAME);
}

/** What you typed in Settings, as dollars to the cent. */
export function readLimit(text: string): { usd: number } | { error: string } {
  const plain = text.trim().replace(/^\$/, "").replace(/,/g, "");
  const amount = /^\d+(\.\d+)?$/.test(plain) ? Math.round(Number(plain) * 100) / 100 : NaN;
  if (Number.isNaN(amount)) return { error: "Type an amount in dollars, like 10." };
  if (amount <= 0) return { error: "Set at least $0.01." };
  return { usd: amount };
}

export type Budget = { state: "none" } | { state: "under" | "near" | "over"; month_usd: number; limit_usd: number };

/** Where this month's spending stands against your limit. */
export function budget(month_usd: number, limit_usd: number | null): Budget {
  if (limit_usd === null) return { state: "none" };
  const state = month_usd >= limit_usd ? "over" : month_usd >= limit_usd * SPEND_WARN_AT ? "near" : "under";
  return { state, month_usd, limit_usd };
}

/** Dollars to the cent: "$10.00". */
export const dollars = (amount: number) => `$${amount.toFixed(2)}`;

/** SPEND_WARN_AT as you read it: "80%". */
export const WARN_PERCENT = `${Math.round(SPEND_WARN_AT * 100)}%`;

/** The warning to show, or null when there is nothing to say. */
export function budgetNote(b: Budget): string | null {
  if (b.state === "near") return `You have spent ${dollars(b.month_usd)} of your ${dollars(b.limit_usd)} limit this month.`;
  if (b.state === "over") return `You are past your ${dollars(b.limit_usd)} limit this month, at ${dollars(b.month_usd)}.`;
  return null;
}

/** What a question past the limit asks before it goes. */
export const overNote = (b: Budget) => `${budgetNote(b)} Ask anyway?`;

/** Whether the next question must write the article to the cache again. lastAt is the start of the
 *  newest call on this article by this model, or null for none. */
export function cacheCold(lastAt: string | null, now: Date): boolean {
  return lastAt === null || now.getTime() - new Date(lastAt).getTime() >= CACHE_TTL_MS;
}

/** What writing the article to the cache costs, with one search and its pages when Look it up is
 *  on. Null for a model with no price. An article is never long enough for Haiku's long-prompt
 *  rates (DOC_TOKENS). */
export function readInCost(articleTokens: number, model: string, search: boolean): number | null {
  const rates = ratesFor(model)?.rates;
  if (!rates) return null;
  const write = articleTokens * rates.cacheWrite1h;
  const searching = search ? WEB_SEARCH_USD * 1_000_000 + SEARCH_PAGE_TOKENS * rates.input : 0;
  return Math.round(write + searching) / 1_000_000;
}

/** The line before a question that reads the article in, or null when it costs too little to say. */
export function readInNote(cost: number | null, search: boolean): string | null {
  if (cost === null || cost < READ_IN_NOTE_FROM_USD) return null;
  return `Reading the article in first${search ? ", with a search" : ""}: about ${dollars(cost)}.`;
}
