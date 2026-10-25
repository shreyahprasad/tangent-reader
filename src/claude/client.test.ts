import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { checkKey, clientFor } from "./client";

const KEY = "sk-ant-api03-made-up-for-tests-WXYZ";

/** A client whose model list answers as given. */
const listing = (result: () => Promise<unknown>) => () => ({ models: { list: result } }) as unknown as ReturnType<typeof clientFor>;

describe("checking a key", () => {
  it("passes when Anthropic lists a model for it", async () => {
    expect(await checkKey(KEY, listing(async () => ({ data: [] })))).toBeNull();
  });

  it("says so when Anthropic rejects it", async () => {
    const rejected = listing(() => Promise.reject(new Anthropic.AuthenticationError(401, undefined, "invalid x-api-key", new Headers())));
    expect(await checkKey(KEY, rejected)).toBe("Anthropic did not accept this key. Check that you copied all of it.");
  });

  it("says when Anthropic cannot be reached", async () => {
    const offline = listing(() => Promise.reject(new Anthropic.APIConnectionError({ message: "fetch failed" })));
    expect(await checkKey(KEY, offline)).toBe("Could not reach Anthropic. Check your connection, then try again.");
  });

  it("asks for a key when there is none", async () => {
    expect(await checkKey("  ")).toBe("Paste your API key first.");
  });
});
