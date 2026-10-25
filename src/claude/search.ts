import type { BetaContentBlock } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { Citation } from "../tangent/data";

// The answer in a reply that may have searched (docs/design.md, Look it up). A reply can
// hold thinking, searches and their results, and text, in any order. The answer is the text after
// the last search step: anything written before a search was about the search, not the answer.
// Cited text comes in its own blocks, so joining the blocks gives plain text with no markers, and
// the answer splits into sentences as any other does.

export type Block = BetaContentBlock;

export interface Answered {
  text: string;
  /** Each source once, in the order the answer first cites it. */
  citations: Citation[];
  /** The last search came back as an error. */
  searchFailed: boolean;
}

/** A search, or its results. Thinking comes between steps but is not one. */
export const isStep = (block: Pick<Block, "type">) => block.type === "server_tool_use" || block.type === "web_search_tool_result";

export function answerOf(content: Block[]): Answered {
  const lastStep = content.reduce((last, block, i) => (isStep(block) ? i : last), -1);
  const after = content.slice(lastStep + 1);
  const texts = after.flatMap((block) => (block.type === "text" ? [block] : []));
  const sources = new Map<string, string>();
  for (const block of texts) {
    for (const c of block.citations ?? []) {
      if (c.type === "web_search_result_location" && !sources.has(c.url)) sources.set(c.url, c.title || siteOf(c.url));
    }
  }
  const lastSearch = content.flatMap((block) => (block.type === "web_search_tool_result" ? [block] : [])).at(-1);
  return {
    text: texts
      .map((block) => block.text)
      .join("")
      .trim(),
    citations: [...sources].map(([url, title]) => ({ url, title })),
    searchFailed: lastSearch !== undefined && !Array.isArray(lastSearch.content),
  };
}

/** Only a web page becomes a link: a javascript: or data: address stays text. */
export function linkable(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function siteOf(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}
