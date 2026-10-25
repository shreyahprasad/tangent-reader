import { describe, expect, it } from "vitest";
import { cost, type Usage } from "./cost";

const usage = (extra: Partial<Usage> = {}): Usage => ({
  input_tokens: 1_000,
  output_tokens: 500,
  cache_creation_input_tokens: 10_000,
  cache_read_input_tokens: 0,
  server_tool_use: null,
  ...extra,
});

describe("the cost of a call", () => {
  it("prices all four kinds of token at the model's rates", () => {
    // Sonnet 5.5: 1k × $2 + 500 × $10 + 10k × $2.50 + 20k × $0.10, per million
    expect(cost("claude-sonnet-5-5", usage({ cache_read_input_tokens: 20_000 }))).toEqual({ cost_usd: 0.034, web_search_cost_usd: null });
  });

  it("prices Haiku's short prompts at its lower rates", () => {
    // 1k × $0.10 + 500 × $0.50 + 10k × $0.125
    expect(cost("claude-haiku-5-5", usage()).cost_usd).toBe(0.0016);
  });

  it("prices a Haiku prompt over 100,000 tokens at the higher rates, counting cached tokens too", () => {
    const at = (read: number) => cost("claude-haiku-5-5", usage({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: read })).cost_usd;
    expect(at(100_000)).toBe(0.001); // × $0.01
    expect(at(100_001)).toBe(0.005); // × $0.05
  });

  it("prices a write to the 1-hour cache at its own rate, and the rest of the writes as 5-minute ones", () => {
    // Sonnet 5.5: 8k × $4 + 2k × $2.50, per million. Web search writes its own 5-minute entries.
    const split = usage({ input_tokens: 0, output_tokens: 0, cache_creation: { ephemeral_1h_input_tokens: 8_000, ephemeral_5m_input_tokens: 2_000 } });
    expect(cost("claude-sonnet-5-5", split).cost_usd).toBe(0.037);
  });

  it("prices Haiku's 1-hour writes at its long-prompt rate past 100,000 tokens", () => {
    const write = (tokens: number) =>
      cost("claude-haiku-5-5", usage({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: tokens, cache_creation: { ephemeral_1h_input_tokens: tokens, ephemeral_5m_input_tokens: 0 } })).cost_usd;
    expect(write(100_000)).toBe(0.02); // × $0.20
    expect(write(200_000)).toBe(0.2); // × $1
  });

  it("prices a call another model answered after a decline at that model's rates", () => {
    // Sonnet 5 reads its cache at $0.20, twice Sonnet 5.5's $0.10
    const read = usage({ input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 1_000_000 });
    expect([cost("claude-sonnet-5-5", read).cost_usd, cost("claude-sonnet-5", read).cost_usd]).toEqual([0.1, 0.2]);
  });

  it("adds each web search, and says what they cost", () => {
    const searched = usage({ server_tool_use: { web_search_requests: 3, web_fetch_requests: 0 } });
    expect(cost("claude-sonnet-5-5", searched)).toEqual({ cost_usd: 0.062, web_search_cost_usd: 0.03 });
  });

  it("leaves a model it has no price for unpriced, and still counts the searches", () => {
    const searched = usage({ server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 } });
    expect(cost("claude-unknown", searched)).toEqual({ cost_usd: null, web_search_cost_usd: 0.01 });
  });
});
