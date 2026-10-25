import { describe, expect, it } from "vitest";
import { budget, budgetNote, cacheCold, forgetLimit, loadLimit, overNote, readInCost, readInNote, readLimit, saveLimit } from "./guard";
import { HAIKU, SONNET } from "./models";

const memory = () => {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    items,
  };
};

describe("the monthly limit", () => {
  it("is none until you set one, and kept once you do", () => {
    const storage = memory();
    expect(loadLimit(storage)).toBeNull();
    saveLimit(10, storage);
    expect(loadLimit(storage)).toBe(10);
    forgetLimit(storage);
    expect(loadLimit(storage)).toBeNull();
  });

  it("reads anything but a positive amount as none", () => {
    for (const kept of ["0", "-5", "ten", "Infinity", ""]) {
      const storage = memory();
      storage.setItem("tangent-reader:limit", kept);
      expect(loadLimit(storage)).toBeNull();
    }
  });

  it("reads as none when storage refuses", () => {
    const refusing = { ...memory(), getItem: () => { throw new Error("denied"); } };
    expect(loadLimit(refusing)).toBeNull();
  });

  it("takes what you type, with or without a dollar sign, to the cent", () => {
    expect(readLimit("10")).toEqual({ usd: 10 });
    expect(readLimit(" $12.50 ")).toEqual({ usd: 12.5 });
    expect(readLimit("1,000")).toEqual({ usd: 1000 });
    expect(readLimit("0.004")).toEqual({ error: "Set at least $0.01." });
    expect(readLimit("0")).toEqual({ error: "Set at least $0.01." });
    expect(readLimit("ten")).toEqual({ error: "Type an amount in dollars, like 10." });
    expect(readLimit("")).toEqual({ error: "Type an amount in dollars, like 10." });
  });
});

describe("where you stand against it", () => {
  it("is nothing to say with no limit", () => {
    expect(budget(500, null)).toEqual({ state: "none" });
    expect(budgetNote(budget(500, null))).toBeNull();
  });

  it("warns at 80% and asks to confirm from 100%", () => {
    expect(budget(7.99, 10).state).toBe("under");
    expect(budget(8, 10).state).toBe("near");
    expect(budget(9.99, 10).state).toBe("near");
    expect(budget(10, 10).state).toBe("over");
    expect(budget(14, 10).state).toBe("over");
  });

  it("says so in plain words", () => {
    expect(budgetNote(budget(3, 10))).toBeNull();
    expect(budgetNote(budget(8.4, 10))).toBe("You have spent $8.40 of your $10.00 limit this month.");
    expect(budgetNote(budget(10.4, 10))).toBe("You are past your $10.00 limit this month, at $10.40.");
    expect(overNote(budget(10.4, 10))).toBe("You are past your $10.00 limit this month, at $10.40. Ask anyway?");
  });
});

describe("the cache", () => {
  const now = new Date("2026-10-14T12:00:00Z");

  it("is cold with no call on the article yet", () => {
    expect(cacheCold(null, now)).toBe(true);
  });

  it("holds for an hour from the last call's start", () => {
    expect(cacheCold("2026-10-14T11:00:01Z", now)).toBe(false);
    expect(cacheCold("2026-10-14T11:00:00Z", now)).toBe(true);
  });
});

describe("reading the article in", () => {
  it("costs the 1-hour cache write for the whole article", () => {
    // 50,000 × $4 per million on Sonnet 5.5, × $0.20 on Haiku 5.5
    expect(readInCost(50_000, SONNET, false)).toBe(0.2);
    expect(readInCost(50_000, HAIKU, false)).toBe(0.01);
  });

  it("adds a search and the pages it reads when Look it up is on", () => {
    // $0.01 + 12,000 × $2 per million
    expect(readInCost(50_000, SONNET, true)).toBe(0.234);
  });

  it("is unknown for a model with no price", () => {
    expect(readInCost(50_000, "claude-unknown", false)).toBeNull();
  });

  it("is said only when it is worth a look", () => {
    expect(readInNote(0.2, false)).toBe("Reading the article in first: about $0.20.");
    expect(readInNote(0.234, true)).toBe("Reading the article in first, with a search: about $0.23.");
    expect(readInNote(0.049, false)).toBeNull();
    expect(readInNote(null, false)).toBeNull();
  });
});
