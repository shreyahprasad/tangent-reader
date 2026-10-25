import { describe, expect, it } from "vitest";
import { exportAll } from "../store/transfer";
import { freshDB } from "../store/testing";
import { sessionSummaries } from "../store/reads";
import { DEMO, DEMO_TITLE, openDemo, sentenceAt, type Step } from "./demo";
import TEXT from "./lovelace-note-a.txt?raw";

const all = (steps: Step[]): Step[] => steps.flatMap((s) => [s, ...all(s.tangents ?? [])]);

describe("the demo", () => {
  it("anchors every step on a whole sentence of the article or of the answer above it", () => {
    for (const step of DEMO) expect(sentenceAt(TEXT, step.on).text).toContain(step.on);
    for (const step of all(DEMO)) for (const t of step.tangents ?? []) expect(sentenceAt(step.answer, t.on).text).toContain(t.on);
  });

  it("refuses a start no sentence has, so a changed text fails here and not on the page", () => {
    expect(() => sentenceAt(TEXT, "Nothing starts like this")).toThrow();
  });

  it("is saved as a real session: one per step, all read, nothing spent", async () => {
    const db = freshDB();
    const id = await openDemo(db);
    const [summary] = await sessionSummaries(db);
    expect(summary).toMatchObject({ id, title: DEMO_TITLE, tokens: 0, cost_usd: 0 });
    expect(await db.threads.count()).toBe(all(DEMO).length);
    expect(await db.messages.count()).toBe(all(DEMO).length * 2);
    expect(await db.messages.filter((m) => m.role === "assistant" && m.read_at === null).count()).toBe(0);
    expect(await db.threads.filter((t) => t.kind === "tangent").count()).toBe(all(DEMO).length - DEMO.length);
  });

  it("opens the one already here rather than adding a second", async () => {
    const db = freshDB();
    const first = await openDemo(db);
    expect(await openDemo(db)).toBe(first);
    expect(await db.sessions.count()).toBe(1);
  });

  it("backs up like any session, with no key in it", async () => {
    const db = freshDB();
    await openDemo(db);
    const file = JSON.stringify(await exportAll(db));
    expect(file).not.toMatch(/sk-ant|x-api-key/);
  });
});
