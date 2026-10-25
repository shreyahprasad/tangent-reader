import Anthropic from "@anthropic-ai/sdk";
import type { Client } from "./answer";
import { TIMEOUT_MS } from "./models";
import type { Kind } from "./reasons";

// The Anthropic SDK, and all that needs it, in one module the page loads only when you ask Claude
// or check a key (src/app/asking.ts, KeyScreen.tsx). The SDK is most of the page's code, so the
// library and your reading open without it.

/** The SDK client, calling Anthropic straight from this browser. The flag is safe here because the
 *  key belongs to the person using the page. */
export function clientFor(apiKey: string): Client & Pick<Anthropic, "models"> {
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true, timeout: TIMEOUT_MS });
}

const REJECTED = "Anthropic did not accept this key. Check that you copied all of it.";
const OFFLINE = "Could not reach Anthropic. Check your connection, then try again.";
const UNCHECKED = "Anthropic could not check this key right now. Try again in a moment.";

/** Checks a key before it is saved, with a call that costs nothing: listing one model. Returns null
 *  when it works, else why not. */
export async function checkKey(key: string, make = clientFor): Promise<string | null> {
  if (!key.trim()) return "Paste your API key first.";
  try {
    await make(key.trim()).models.list({ limit: 1 });
    return null;
  } catch (error) {
    const kind = classify(error);
    return kind === "auth" ? REJECTED : kind === "unreachable" ? OFFLINE : UNCHECKED;
  }
}

/** Why a call failed (reasons.ts), most specific first. Out of credit is a 402, or a 400 that says
 *  so. An error in the middle of a stream has no status, only its type. */
export function classify(error: unknown): Kind {
  if (error instanceof Anthropic.AuthenticationError) return "auth";
  if (error instanceof Anthropic.PermissionDeniedError) return "permission";
  if (error instanceof Anthropic.RateLimitError) return "rate_limited";
  if (error instanceof Anthropic.APIConnectionError) return "unreachable";
  if (!(error instanceof Anthropic.APIError)) return "unexpected";
  const said = error.message.toLowerCase();
  const type: string | null = error.type; // the SDK's list of types leaves some out
  if (error.status === 402 || type === "billing_error") return "no_credit";
  if (error.status === 400) return said.includes("credit balance") || said.includes("billing") ? "no_credit" : "bad_request";
  if (error.status === 413 || type === "request_too_large") return "too_large";
  if (error.status === 529 || type === "overloaded_error") return "overloaded";
  if (type === "rate_limit_error") return "rate_limited";
  return "api_error";
}
