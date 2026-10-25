import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Refused, Rejected } from "./errors";
import { INTERRUPTED } from "./rules";
import { DB_VERSION, TABLES, type TangentDB } from "./schema";
import { addVisits, ask, createSession, openAnchor, openTangent } from "./store";
import { answeredThread, freshDB } from "./testing";
import { eraseEverything, exportAll, importFile, type ExportFile } from "./transfer";

let here: TangentDB;
let there: TangentDB;
beforeEach(() => {
  here = freshDB();
  there = freshDB();
});
afterEach(() => {
  here.close();
  there.close();
});

/** Two sessions: one with an answer, a tangent waiting on its question, and visits; one from a link. */
async function reading() {
  const one = await answeredThread(here);
  const { thread_id } = await openTangent(here, one.answer_id, "p0:s1", "Floods do most of the work.");
  await ask(here, thread_id, "Which floods?");
  await addVisits(here, one.session_id, [{ at: "2026-10-05T18:00:00.000Z", view: "thread", thread_id, anchor_key: "p0:s0", sheet: "full", via: "branch" }]);
  const two = await createSession(here, { text: "Glaciers move. They carve valleys.", source: "url", source_ref: "https://example.com/ice" });
  await openAnchor(here, two.session_id, "p0:s1", "They carve valleys.");
  return { one, two, tangent: thread_id };
}

const without = ({ exported_at: _, ...rest }: ExportFile) => rest;

/** An export cut down to one session, as an older backup taken before the others were made. */
function alone(file: ExportFile, sessionId: string): ExportFile {
  const session = file.sessions.find((s) => s.id === sessionId)!;
  const threads = file.threads.filter((t) => t.session_id === sessionId);
  const ids = new Set(threads.map((t) => t.id));
  return {
    ...file,
    articles: file.articles.filter((a) => a.id === session.article_id),
    sessions: [session],
    threads,
    messages: file.messages.filter((m) => ids.has(m.thread_id)),
    calls: file.calls.filter((c) => c.session_id === sessionId),
    visits: file.visits.filter((v) => v.session_id === sessionId),
  };
}
const count = async (db: TangentDB) => Object.fromEntries(await Promise.all(TABLES.map(async (t) => [t, await db.table(t).count()])));

describe("export and import", () => {
  it("move everything to another device as it was, with what was in flight marked interrupted", async () => {
    const { tangent } = await reading();
    const file = await exportAll(here);
    expect([file.format, file.version]).toEqual(["tangent-reader", DB_VERSION]);
    expect(await importFile(there, JSON.stringify(file))).toEqual({ added: 2, skipped: 0 });

    const moved = await exportAll(there);
    const waiting = file.messages.find((m) => m.thread_id === tangent)!;
    expect(moved.messages.find((m) => m.id === waiting.id)).toEqual({ ...waiting, status: "interrupted", error: INTERRUPTED });
    const settled = { ...file, messages: file.messages.map((m) => (m.id === waiting.id ? { ...m, status: "interrupted", error: INTERRUPTED } : m)) };
    expect(without(moved)).toEqual(without(settled as ExportFile));
  });

  it("never carry anything but the listed fields, so never your key", async () => {
    const { one } = await reading();
    const row = (await here.sessions.get(one.session_id))!;
    await here.sessions.put({ ...row, api_key: "sk-ant-made-up" } as typeof row);
    expect(JSON.stringify(await exportAll(here))).not.toContain("sk-ant-");
  });

  it("keep a session already on this device as it is, and add the rest", async () => {
    const { one } = await reading();
    const everything = await exportAll(here);
    const file = JSON.stringify(everything);
    await importFile(there, JSON.stringify(alone(everything, one.session_id)));
    await ask(there, (await there.threads.toArray())[0].id, "Asked only there?");
    const before = await count(there);
    expect(await importFile(there, file)).toEqual({ added: 1, skipped: 1 });
    expect(await importFile(there, file)).toEqual({ added: 0, skipped: 2 });
    expect((await count(there)).messages).toBe(before.messages); // the session here kept its new question, the file's did not replace it
  });
});

describe("an import", () => {
  it.each<[string, (file: ExportFile) => unknown, string]>([
    ["is not JSON", () => "{ nope", "This is not a Tangent Reader export."],
    ["is someone else's JSON", () => ({ hello: "world" }), "This is not a Tangent Reader export."],
    ["breaks a rule in one row", (f) => ({ ...f, threads: f.threads.map((t) => (t.kind === "anchor" ? { ...t, anchor_text: "Not there." } : t)) }), "not in the article"],
    ["is missing a table", ({ visits: _, ...f }) => f, "visits is missing"],
  ])("that %s is refused whole, and nothing is written", async (_, make, says) => {
    await reading();
    const made = make(await exportAll(here));
    const sent = typeof made === "string" ? made : JSON.stringify(made);
    await expect(importFile(there, sent)).rejects.toThrow(Rejected);
    await expect(importFile(there, sent)).rejects.toThrow(says);
    expect(Object.values(await count(there)).every((n) => n === 0)).toBe(true);
  });

  it("from a newer version is refused until the page is updated", async () => {
    const file = { ...(await exportAll(here)), version: DB_VERSION + 1 };
    await expect(importFile(there, JSON.stringify(file))).rejects.toThrow(Refused);
  });

  it("whose rows are already here under another session is refused whole", async () => {
    const { one } = await reading();
    const file = alone(await exportAll(here), one.session_id);
    const renamed = { ...file, sessions: [{ ...file.sessions[0], id: crypto.randomUUID() }] };
    renamed.threads = file.threads.map((t) => ({ ...t, session_id: renamed.sessions[0].id }));
    renamed.calls = file.calls.map((c) => ({ ...c, session_id: renamed.sessions[0].id }));
    renamed.visits = file.visits.map((v) => ({ ...v, session_id: renamed.sessions[0].id }));
    const before = await count(here);
    await expect(importFile(here, JSON.stringify(renamed))).rejects.toThrow(Refused);
    expect(await count(here)).toEqual(before);
  });
});

describe("delete everything", () => {
  it("empties every table, and a backup made first brings it all back", async () => {
    await reading();
    const backup = JSON.stringify(await exportAll(here));
    await eraseEverything(here);
    for (const t of TABLES) expect(await here.table(t).count()).toBe(0);
    expect(await importFile(here, backup)).toEqual({ added: 2, skipped: 0 });
  });
});
