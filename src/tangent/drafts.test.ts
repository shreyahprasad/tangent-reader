import { describe, expect, it } from "vitest";
import { clearDrafts, loadDraft, saveDraft } from "./drafts";

const memory = () => {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    get length() {
      return items.size;
    },
    key: (i: number) => [...items.keys()][i] ?? null,
    items,
  };
};

describe("drafts", () => {
  it("survive a reload, per thread", () => {
    const storage = memory();
    saveDraft("t1", "Why did the river", storage);
    saveDraft("t2", "Other thread", storage);
    expect(loadDraft("t1", storage)).toBe("Why did the river");
    expect(loadDraft("t2", storage)).toBe("Other thread");
    expect(loadDraft("t3", storage)).toBe("");
  });

  it("are cleared once sent, and a blank one is not kept", () => {
    const storage = memory();
    saveDraft("t1", "Sent now", storage);
    saveDraft("t1", "", storage); // what sending does
    saveDraft("t2", "   ", storage);
    expect(storage.items.size).toBe(0);
  });

  it("are simply not kept when storage refuses", () => {
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {},
    };
    expect(() => saveDraft("t1", "x", refusing)).not.toThrow();
    expect(loadDraft("t1", refusing)).toBe("");
    expect(loadDraft("t1", null)).toBe("");
  });
});

describe("clearing drafts", () => {
  it("removes every draft and nothing else", () => {
    const storage = memory();
    saveDraft("t1", "One", storage);
    saveDraft("t2", "Two", storage);
    storage.setItem("tangent-reader:anthropic-key", "kept");
    clearDrafts(storage);
    expect([...storage.items.keys()]).toEqual(["tangent-reader:anthropic-key"]);
  });
});
