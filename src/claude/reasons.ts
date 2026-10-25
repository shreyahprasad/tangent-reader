// What you read when an answer fails (docs/design.md, Asking Claude). Written here, never forwarded from
// the SDK, which could echo back what was sent.

export const REASONS = {
  no_key: "Add your Anthropic API key to ask Claude.",
  auth: "Anthropic did not accept your API key. Check it in Settings, or add a new one.",
  no_credit: "Your Anthropic account is out of credit. Add credit in the Anthropic Console, then ask again.",
  permission: "Your API key is not allowed to use this model. Check its workspace in the Anthropic Console, or choose another model in Settings.",
  bad_request: "Anthropic turned down the request. Ask again. If it keeps happening, this thread may be too long.",
  too_large: "This is too long to send to Claude in one request.",
  rate_limited: "Anthropic is limiting how fast your key can ask. Wait a moment, then ask again.",
  overloaded: "Anthropic is busy right now. Wait a minute, then ask again.",
  unreachable: "Could not reach Anthropic. Check your connection, then ask again.",
  api_error: "Anthropic returned an error. Ask again.",
  refusal: "Claude declined to answer this one. Try asking it another way.",
  empty: "Claude sent back an empty answer. Ask again.",
  search_failed: "The search did not work this time. Ask again, or turn off Look it up.",
  unexpected: "Something went wrong getting the answer. Ask again.",
  not_loaded: "Could not load the part of the page that asks Claude. Check your connection, then reload the page.",
} as const;

export type Kind = keyof typeof REASONS;
