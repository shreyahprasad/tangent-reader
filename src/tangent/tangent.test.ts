import { describe, expect, it } from "vitest";
import type { Message, Thread } from "./data";
import { parseArticle } from "./sentences";
import counts from "./fixtures/tokens/counts.json";
import { DOC_TOKENS } from "./style";
import {
  anchorMarks,
  dayLabel,
  defaultTitle,
  dotStep,
  isDrag,
  baseFor,
  closesTo,
  isLookingUp,
  isThinking,
  isWaiting,
  lookItUpCost,
  keyboardUp,
  normalizeArticle,
  estimateTokens,
  sourceLine,
  aboutTokens,
  sizeStatus,
  pathTo,
  pendingIn,
  railFor,
  sessionShape,
  marksKey,
  sessionUsage,
  usd,
  sheetAfterDrag,
  sheetFrame,
  stripRelease,
  tangentMarks,
  tapAction,
  unreadIn,
  withPending,
} from "./tangent";

const thread = (id: string, key: string, parent: string | null = null): Thread => ({
  id,
  kind: parent ? "tangent" : "anchor",
  parent_thread_id: parent,
  from_message_id: parent ? `${parent}-answer` : null,
  anchor_key: key,
  anchor_text: "x",
  flagged: false,
  created_at: "2026-10-05T10:00:00.000Z",
});

const message = (threadId: string, seq: number): Message => ({
  id: `${threadId}-${seq}`,
  thread_id: threadId,
  seq,
  role: seq % 2 ? "user" : "assistant",
  text: "x",
  status: "done",
  error: null,
  search: false,
  citations: [],
  call_id: seq % 2 ? null : `call-${threadId}-${seq}`,
  truncated: false,
  read_at: seq % 2 ? null : "2026-10-05T10:01:00.000Z",
  created_at: "2026-10-05T10:00:00.000Z",
});

describe("pasting", () => {
  it("normalizes line endings and trims, so sentences are found in the saved text", () => {
    expect(normalizeArticle("  One.\r\n\r\nTwo.\rThree.\n ")).toBe("One.\n\nTwo.\nThree.");
  });

  it("titles a session by its first sentence, cut at a word when long", () => {
    expect(defaultTitle("The Grand Canyon is a mile deep. Dr. Smith measured it.\n\nMore.")).toBe("The Grand Canyon is a mile deep.");
    expect(defaultTitle("Dr. Smith left the U.S. on Jan. 5th. Then more.")).toBe("Dr. Smith left the U.S. on Jan. 5th.");
    const long = "Rivers carve canyons over millions of years, and the grit they carry, the floods that move it, and the rock itself all decide how fast.";
    expect(defaultTitle(long)).toBe("Rivers carve canyons over millions of years, and the grit they carry, the…");
    expect(defaultTitle("   ")).toBe("");
  });

});

// Made-up texts measured with Anthropic's count_tokens (fixtures/tokens, scripts/count-tokens.mjs).
const fixtures = import.meta.glob<string>("./fixtures/tokens/*.txt", { query: "?raw", import: "default", eager: true });

describe("where an article came from", () => {
  it("names a link's site and links to it, a file by its name, and a paste not at all", () => {
    expect(sourceLine("url", "https://www.example.com/essay?id=7")).toEqual({ text: "From example.com", href: "https://www.example.com/essay?id=7" });
    expect(sourceLine("url", "http://news.example/a")).toEqual({ text: "From news.example", href: "http://news.example/a" });
    expect(sourceLine("file", "notes.pdf")).toEqual({ text: "From notes.pdf", href: null });
    expect(sourceLine("paste", null)).toBeNull();
  });

  it("never draws a link to anything but a web address", () => {
    expect(sourceLine("url", "javascript:alert(1)")).toEqual({ text: "From a link", href: null });
    expect(sourceLine("url", null)).toBeNull();
  });
});

describe("document size", () => {
  it("estimates within -10% and +25% of the measured count, for every script and model", () => {
    for (const [model, byFile] of Object.entries(counts.models)) {
      for (const [file, { tokens }] of Object.entries(byFile)) {
        const ratio = estimateTokens(fixtures[`./fixtures/tokens/${file}`]) / tokens;
        expect(ratio, `${model} ${file}`).toBeGreaterThanOrEqual(0.9);
        expect(ratio, `${model} ${file}`).toBeLessThanOrEqual(1.25);
      }
    }
  });

  it("counts plain ASCII as the general rule does, by kind", () => {
    expect(estimateTokens("abc")).toBe(Math.round(3 * 0.33));
    // Two letters, two digits, a comma, and four kinds of white space.
    expect(estimateTokens("Ab 12, \t\n")).toBe(Math.round(2 * 0.33 + 2 * 1.1 + 0.75 + 4 * 0.25));
  });

  it("counts nothing as nothing", () => {
    expect(estimateTokens("")).toBe(0);
  });

  // "a" is a Latin letter: a third of a token each.
  const tokensOfA = (tokens: number) => "a".repeat(Math.round(tokens / 0.33));

  it("can save anything up to the limit, and says the size only near it", () => {
    expect(sizeStatus("   ")).toMatchObject({ canSave: false, over: false, note: null });
    expect(sizeStatus("Short.")).toMatchObject({ canSave: true, over: false, note: null });
    expect(sizeStatus(tokensOfA(DOC_TOKENS * 0.5)).note).toBeNull();
    expect(sizeStatus(tokensOfA(40_000))).toMatchObject({ canSave: true, over: false, note: "About 40,000 of 50,000 tokens." });
  });

  it("refuses over the limit and says how much to cut from a paste", () => {
    expect(sizeStatus(tokensOfA(62_000))).toMatchObject({
      canSave: false,
      over: true,
      note: "That is about 62,000 tokens. Tangent reads up to 50,000 at a time, so cut about 20% and paste again.",
    });
  });

  it("refuses a file or a page whole, since it cannot be cut here", () => {
    for (const source of ["file", "url"] as const) {
      expect(sizeStatus(tokensOfA(62_000), source).note).toBe(
        "That is about 62,000 tokens. Tangent reads up to 50,000 at a time. Try a shorter piece, or paste just the part you want.",
      );
    }
  });

  it("never shows an over-limit size rounded down to the limit", () => {
    expect(sizeStatus(tokensOfA(DOC_TOKENS + 20)).note).toMatch(/^That is about 50,100 tokens\./);
  });

  it("says a size at a glance", () => {
    expect(aboutTokens(3)).toBe("about 10 tokens");
    expect(aboutTokens(347)).toBe("about 350 tokens");
    expect(aboutTokens(12_345)).toBe("about 12,300 tokens");
  });

  it("gives the estimate with the status", () => {
    expect(sizeStatus(tokensOfA(1000)).tokens).toBe(estimateTokens(tokensOfA(1000)));
  });
});

describe("marks", () => {
  // a is anchored with a two-message talk and a tangent t below it; t's answer is unread and
  // it has a question waiting. b is anchored with nothing said.
  const threads = [thread("a", "p0:s0"), thread("b", "p0:s2"), thread("t", "p0:s1", "a")];
  const messages = [
    message("a", 1),
    message("a", 2),
    message("t", 1),
    { ...message("t", 2), read_at: null },
    { ...message("t", 3), status: "pending" as const },
  ];
  const marks = anchorMarks({ threads, messages });
  const none = { unread: false, waiting: false };

  it("map each anchor to its sentence, with what is below it gathered up", () => {
    expect([...marks]).toEqual([
      ["p0:s0", { threadId: "a", messages: 2, nested: true, unread: true, waiting: true }],
      ["p0:s2", { threadId: "b", messages: 0, nested: false, ...none }],
    ]);
  });

  it("put tangents on the answer they branched from, not the article", () => {
    expect([...marks.values()].map((m) => m.threadId)).not.toContain("t");
    expect([...tangentMarks({ threads, messages }, "a-answer")]).toEqual([
      ["p0:s1", { threadId: "t", messages: 3, nested: false, unread: true, waiting: true }],
    ]);
    expect(tangentMarks({ threads, messages }, "b-answer").size).toBe(0);
  });

  it("step the dot by how much was said", () => {
    expect([0, 1, 2, 3, 5, 6, 40].map(dotStep)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it("show a tap at once, before the store answers", () => {
    const shown = withPending(marks, new Map([["p0:s2", "undo"], ["p1:s0", "anchor"], ["p0:s0", "anchor"]]));
    expect([...shown.keys()]).toEqual(["p0:s0", "p1:s0"]);
    expect(shown.get("p1:s0")).toEqual({ threadId: "", messages: 0, nested: false, ...none });
    expect(shown.get("p0:s0")).toEqual(marks.get("p0:s0")); // already saved: kept as saved
  });

  it("keep taps in the article apart from taps in an answer", () => {
    const busy = new Map([["article|p0:s1", "anchor"], ["m1|p0:s1", "undo"]] as const);
    expect([...pendingIn(new Map(busy), "article")]).toEqual([["p0:s1", "anchor"]]);
    expect([...pendingIn(new Map(busy), "m1")]).toEqual([["p0:s1", "undo"]]);
  });

  it("decide what a tap does", () => {
    expect(tapAction(undefined)).toBe("anchor");
    expect(tapAction({ threadId: "b", messages: 0, nested: false, ...none })).toBe("undo");
    expect(tapAction(marks.get("p0:s0"))).toBe("open");
  });
});

describe("threads", () => {
  const threads = [thread("a", "p0:s0"), thread("t", "p0:s1", "a"), thread("u", "p0:s0", "t")];

  it("read an anchor against the article, and a tangent against the answer it came from", () => {
    const answer = { ...message("t", 2), id: "m-from", role: "assistant" as const };
    const tangent = { ...thread("u", "p0:s1", "t"), from_message_id: "m-from" };
    const path = [thread("a", "p0:s0"), thread("t", "p0:s1", "a"), tangent];
    expect(baseFor({ messages: [answer] }, path.slice(0, 1))).toEqual({ kind: "article" });
    expect(baseFor({ messages: [answer] }, path)).toEqual({ kind: "answer", answer, parent: path[1], lit: "p0:s1" });
    expect(baseFor({ messages: [] }, path)).toEqual({ kind: "article" }); // its answer not loaded: the article, never a blank
  });

  it("close one level up: a tangent to its parent, an anchor to the article", () => {
    const path = [thread("a", "p0:s0"), thread("t", "p0:s1", "a")];
    expect(closesTo(path)?.id).toBe("a");
    expect(closesTo(path.slice(0, 1))).toBeNull();
  });

  it("trace the path from the article down", () => {
    expect(pathTo({ threads }, "u").map((t) => t.id)).toEqual(["a", "t", "u"]);
    expect(pathTo({ threads }, "a").map((t) => t.id)).toEqual(["a"]);
    expect(pathTo({ threads }, "gone")).toEqual([]);
  });

  it("know when a question is waiting and when an answer is unseen", () => {
    expect(isWaiting({ messages: [message("a", 1)] })).toBe(false);
    expect(isWaiting({ messages: [{ ...message("a", 1), status: "pending" }] })).toBe(true);
    expect(unreadIn([message("a", 2)])).toBe(false);
    expect(unreadIn([{ ...message("a", 2), read_at: null }])).toBe(true);
    expect(unreadIn([message("a", 1)])).toBe(false); // a question is never unread
  });

  it("count a reply still arriving as waiting, since its question stays pending until it is done", () => {
    const streaming = [{ ...message("a", 1), status: "pending" as const }, { ...message("a", 2), status: "streaming" as const }];
    expect(isWaiting({ messages: streaming })).toBe(true);
    const cut = [{ ...message("a", 1), status: "interrupted" as const }, { ...message("a", 2), status: "interrupted" as const }];
    expect(isWaiting({ messages: cut })).toBe(false);
  });

  it("think until the reply starts, even when asked again above an answer cut short", () => {
    const q = { ...message("a", 1), status: "pending" as const };
    const cut = { ...message("a", 2), status: "interrupted" as const };
    expect(isThinking([q])).toBe(true);
    expect(isThinking([q, cut])).toBe(true);
    expect(isThinking([q, cut, { ...message("a", 3), status: "streaming" as const }])).toBe(false);
    expect(isThinking([{ ...q, status: "done" }, message("a", 2)])).toBe(false);
  });

  it("say Claude is looking it up only while a question with Look it up on waits for its reply", () => {
    const q = { ...message("a", 1), status: "pending" as const };
    expect(isLookingUp([q])).toBe(false);
    expect(isLookingUp([{ ...q, search: true }])).toBe(true);
    expect(isLookingUp([{ ...q, search: true }, { ...message("a", 2), status: "streaming" as const }])).toBe(false);
  });

  it("give Look it up's cost from the model numbers", () => {
    expect(lookItUpCost()).toBe("About 1¢ a search, up to 3, plus the pages Claude reads.");
  });
});

describe("the phone's sheet", () => {
  const h = 800; // SHEET_SNAP of it is 96px

  it("springs back from a short drag", () => {
    expect(sheetAfterDrag("half", 50, h)).toBe("half");
    expect(sheetAfterDrag("full", 80, h)).toBe("full");
  });

  it("opens full, or closes, from half", () => {
    expect(sheetAfterDrag("half", -120, h)).toBe("full");
    expect(sheetAfterDrag("half", 120, h)).toBe("closed");
  });

  it("fills the visible area when full, or whenever the keyboard is up", () => {
    expect(sheetFrame("half", { height: 800, offsetTop: 0 }, 800)).toBeNull();
    expect(sheetFrame("full", { height: 800, offsetTop: 0 }, 800)).toEqual({ top: 0, height: 800 });
    // keyboard up: 460px visible, and Safari has slid the page up 300px
    expect(sheetFrame("half", { height: 460, offsetTop: 300 }, 800)).toEqual({ top: 300, height: 460 });
    expect(sheetFrame("full", { height: 460, offsetTop: 300 }, 800)).toEqual({ top: 300, height: 460 });
  });

  it("drops to half from full, and closes on a long drag", () => {
    expect(sheetAfterDrag("full", 150, h)).toBe("half");
    expect(sheetAfterDrag("full", 400, h)).toBe("closed");
  });
});

describe("the rail", () => {
  const [paragraph] = parseArticle("One. Two. Three. Four.");
  const mark = (messages: number) => ({ threadId: "x", messages, nested: false, unread: false, waiting: false });

  it("is empty with no anchors in the paragraph", () => {
    expect(railFor(paragraph, new Map())).toBeNull();
  });

  it("has a mark per anchor, then one bar from three", () => {
    expect(railFor(paragraph, new Map([["p0:s0", mark(0)]]))).toEqual({ marks: 1, merged: false, said: false });
    const three = new Map([["p0:s0", mark(0)], ["p0:s1", mark(2)], ["p0:s3", mark(0)]]);
    expect(railFor(paragraph, three)).toEqual({ marks: 3, merged: true, said: true });
  });
});

describe("the library", () => {
  it("describes a session by its shape", () => {
    expect(sessionShape({ threads: 0, questions: 0 })).toBe("Not started");
    expect(sessionShape({ threads: 1, questions: 0 })).toBe("1 thread");
    expect(sessionShape({ threads: 3, questions: 1 })).toBe("3 threads · 1 question");
  });

  it("shows usage once there is some", () => {
    expect(sessionUsage({ tokens: 0, cost_usd: 0 })).toBeNull();
    expect(sessionUsage({ tokens: 850, cost_usd: 0.0061 })).toBe("850 tokens · $0.01");
    expect(sessionUsage({ tokens: 12_430, cost_usd: 0.0412 })).toBe("12.4k tokens · $0.04");
    expect(sessionUsage({ tokens: 900, cost_usd: 0.0003 })).toBe("900 tokens · under $0.01");
  });

  it("writes dollars to the cent, and never calls a small spend nothing", () => {
    expect(usd(0)).toBe("$0.00");
    expect(usd(0.0049)).toBe("under $0.01");
    expect(usd(0.005)).toBe("$0.01");
    expect(usd(12.3456)).toBe("$12.35");
  });

  it("names the day as you would say it", () => {
    const now = new Date(2026, 9, 5, 9, 0);
    expect(dayLabel(new Date(2026, 9, 5, 1, 0).toISOString(), now)).toBe("Today");
    expect(dayLabel(new Date(2026, 9, 4, 23, 0).toISOString(), now)).toBe("Yesterday");
    expect(dayLabel(new Date(2026, 9, 1, 12, 0).toISOString(), now)).toBe("Oct 1");
    expect(dayLabel(new Date(2025, 9, 1, 12, 0).toISOString(), now)).toBe("Oct 1, 2025");
  });
});

// What testing on a real phone found, each report pinned as a rule.
describe("what the phone test found", () => {
  const phone = 844; // an iPhone's page height

  it("the tapped sentence stays on screen when the keyboard opens", () => {
    // Safari keeps the page 844 tall, shows 470 above the keyboard, and slides the page up 374.
    const keyboard = { height: 470, offsetTop: 374 };
    expect(keyboardUp(keyboard, phone)).toBe(true);
    // The sheet fills exactly what is visible, from its top: the header and sentence included.
    expect(sheetFrame("half", keyboard, phone)).toEqual({ top: 374, height: 470 });
    expect(sheetFrame("full", keyboard, phone)).toEqual({ top: 374, height: 470 });
    // Safari's own bars showing and hiding are not a keyboard.
    expect(keyboardUp({ height: 780, offsetTop: 0 }, phone)).toBe(false);
  });

  it("a swipe up that starts on the header row opens the sheet full, not only a tap", () => {
    expect(stripRelease("half", -250, false, phone)).toEqual({ kind: "settle", to: "full" });
    // even when the finger lands on Back or × first: past the slop it is a drag
    expect(stripRelease("half", -250, true, phone)).toEqual({ kind: "settle", to: "full" });
  });

  it("a swipe down on the header row takes it down a stop, or closes it", () => {
    expect(stripRelease("full", 200, false, phone)).toEqual({ kind: "settle", to: "half" });
    expect(stripRelease("half", 200, false, phone)).toEqual({ kind: "settle", to: "closed" });
  });

  it("taps still do what they say: Back and × are buttons, the rest of the strip toggles", () => {
    expect(stripRelease("half", 0, true, phone)).toEqual({ kind: "button" });
    expect(stripRelease("half", 3, true, phone)).toEqual({ kind: "button" }); // a wobbly thumb
    expect(stripRelease("half", 0, false, phone)).toEqual({ kind: "toggle", to: "full" });
    expect(stripRelease("full", 0, false, phone)).toEqual({ kind: "toggle", to: "half" });
    expect(isDrag(5)).toBe(false);
    expect(isDrag(-6)).toBe(true);
  });
});

describe("marks key", () => {
  const mark = { threadId: "a", messages: 1, nested: false, unread: false, waiting: false };

  it("is the same for marks that draw the same, and changes with anything a dot shows", () => {
    const one = new Map([["p0:s0", mark]]);
    expect(marksKey(new Map([["p0:s0", { ...mark }]]))).toBe(marksKey(one));
    for (const changed of [{ messages: 2 }, { nested: true }, { unread: true }, { waiting: true }, { threadId: "b" }]) {
      expect(marksKey(new Map([["p0:s0", { ...mark, ...changed }]]))).not.toBe(marksKey(one));
    }
    expect(marksKey(new Map([["p0:s1", mark]]))).not.toBe(marksKey(one));
  });
});
