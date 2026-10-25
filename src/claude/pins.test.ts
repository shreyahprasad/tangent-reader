import { beforeAll, describe, expect, it } from "vitest";
import { promptFor } from "../store/reads";
import type { TangentDB } from "../store/schema";
import { ask, createSession, finishAnswer, openAnchor, openTangent } from "../store/store";
import { aCall, ANSWER, ARTICLE, FIRST, freshDB } from "../store/testing";
import { SONNET } from "./models";
import { requestFor, type Request } from "./request";

// The whole request for a question, pinned, as the store and the prompt build it today
// (docs/design.md, Asking Claude). Any change to the prompt, the path or the request shows here as a
// diff in review. The files in pins/ are rewritten with `pnpm test -u`, never by hand.
//
// And the rule every change must keep: the article is the first block, byte for byte the same in
// every thread of a session, so the cache written by one question serves the next.

const TODAY = "2026-10-15";

let db: TangentDB;
const asked: Record<string, string> = {};

/** Answers a waiting question with made-up text, and returns the answer's id. */
const answered = async (questionId: string, text: string) => (await finishAnswer(db, questionId, { call: aCall(), text, truncated: false, citations: [] })).message_id;

beforeAll(async () => {
  db = freshDB();
  const { session_id } = await createSession(db, { text: ARTICLE });
  const { thread_id: anchor } = await openAnchor(db, session_id, "p0:s0", FIRST);
  const a1 = await answered((await ask(db, anchor, "Why so slow?")).message_id, ANSWER);
  asked.anchor = (await ask(db, anchor, "And floods?")).message_id;

  const { thread_id: one } = await openTangent(db, a1, "p0:s1", "Floods do most of the work.");
  const a2 = await answered((await ask(db, one, "Which floods?")).message_id, "Spring melt mostly. Each spring, snowmelt swells the river.");
  asked.tangent = (await ask(db, one, "Every year?")).message_id;

  const { thread_id: two } = await openTangent(db, a2, "p0:s1", "Each spring, snowmelt swells the river.");
  const a3 = await answered((await ask(db, two, "How much?")).message_id, "Swollen rivers move boulders. The canyon deepens fastest then.");
  const { thread_id: three } = await openTangent(db, a3, "p0:s0", "Swollen rivers move boulders.");
  asked.deep = (await ask(db, three, "How big a boulder?")).message_id;

  const { thread_id: second } = await openAnchor(db, session_id, "p1:s0", "The Colorado River cut the Grand Canyon.");
  asked.search = (await ask(db, second, "When did it start?", true)).message_id;
});

const requestOf = async (name: string): Promise<Request> => requestFor(await promptFor(db, asked[name]), SONNET, TODAY);

describe("the pinned request", () => {
  it.each([
    ["anchor", "for a question in an anchor, after an answered one"],
    ["tangent", "for a tangent on an answer sentence"],
    ["deep", "for a tangent three levels deep"],
    ["search", "for a question with Look it up on"],
  ])("%s: %s", async (name) => {
    await expect(JSON.stringify(await requestOf(name), null, 2) + "\n").toMatchFileSnapshot(`./pins/${name}.json`);
  });
});

describe("the cache", () => {
  /** What the API keys the article's cache entry on: the tools, then the system blocks up to and
   *  including the one marked for caching. */
  const prefix = (request: Request) => JSON.stringify({ tools: "tools" in request ? request.tools : null, article: request.system[0] });

  it("is written only on the article, the first block", async () => {
    for (const name of Object.keys(asked)) {
      const { system } = await requestOf(name);
      expect(system[0].text.startsWith("Full article for reference:\n")).toBe(true);
      expect(system[0].cache_control).toEqual({ type: "ephemeral", ttl: "1h" });
      expect(system.slice(1).some((block) => "cache_control" in block)).toBe(false);
    }
  });

  it("keys the same in every thread asked the same way, whatever its depth", async () => {
    const plain = await Promise.all(["anchor", "tangent", "deep"].map(requestOf));
    expect(new Set(plain.map(prefix)).size).toBe(1);
  });
});
