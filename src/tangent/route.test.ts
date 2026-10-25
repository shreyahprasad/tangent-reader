import { describe, expect, it } from "vitest";
import type { Visit } from "./data";
import { fallback, parse, placeKey, toHash, type View } from "./route";

const visit = (thread_id: string | null, anchor_key: string | null): Visit => ({
  seq: 1,
  at: "2026-10-09T10:00:00.000Z",
  view: thread_id ? "thread" : "article",
  thread_id,
  anchor_key,
  sheet: thread_id ? "half" : null,
  via: "sentence",
});

describe("parse and toHash", () => {
  const places: [string, View][] = [
    ["#/", { kind: "library" }],
    ["#/s1", { kind: "article", session: "s1", at: null }],
    ["#/s1/at/p3%3As2", { kind: "article", session: "s1", at: "p3:s2" }],
    ["#/s1/t/t9", { kind: "thread", session: "s1", thread: "t9", sheet: "half" }],
    ["#/s1/t/t9/full", { kind: "thread", session: "s1", thread: "t9", sheet: "full" }],
  ];

  it.each(places)("reads %s, and writes it back the same", (hash, view) => {
    const path = hash.replace("#/", "").split("/").filter(Boolean).map(decodeURIComponent);
    expect(parse(path)).toEqual(view);
    expect(toHash(view)).toBe(hash);
  });

  it("reads a half-finished or unknown address as the nearest place", () => {
    expect(parse(["s1", "t"])).toEqual({ kind: "article", session: "s1", at: null });
    expect(parse(["s1", "at"])).toEqual({ kind: "article", session: "s1", at: null });
    expect(parse(["s1", "elsewhere"])).toEqual({ kind: "article", session: "s1", at: null });
    expect(parse(["s1", "t", "t9", "tall"])).toEqual({ kind: "thread", session: "s1", thread: "t9", sheet: "half" });
  });
});

describe("placeKey", () => {
  it("ignores the sheet's height, so a drag is not a new place", () => {
    const half: View = { kind: "thread", session: "s1", thread: "t9", sheet: "half" };
    expect(placeKey({ ...half, sheet: "full" })).toBe(placeKey(half));
  });

  it("tells the article apart from the article at a sentence", () => {
    expect(placeKey({ kind: "article", session: "s1", at: null })).not.toBe(placeKey({ kind: "article", session: "s1", at: "p0:s0" }));
  });
});

describe("fallback", () => {
  const gone: View = { kind: "thread", session: "s1", thread: "t9", sheet: "full" };

  it("sends a thread that is gone to its sentence on the article, found in the trail", () => {
    expect(fallback(gone, [visit("t2", "p0:s0"), visit("t9", "p4:s1")])).toEqual({ kind: "article", session: "s1", at: "p4:s1" });
  });

  it("sends it to the top of the article when the trail never saw it", () => {
    expect(fallback(gone, [visit("t2", "p0:s0")])).toEqual({ kind: "article", session: "s1", at: null });
  });
});
