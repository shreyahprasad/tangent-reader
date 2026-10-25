import { describe, expect, it } from "vitest";
import { applyTheme, forgetTheme, loadTheme, saveTheme } from "./theme";

const memory = () => {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    items,
  };
};

const root = () => {
  const attributes = new Map<string, string>();
  return {
    setAttribute: (k: string, v: string) => void attributes.set(k, v),
    removeAttribute: (k: string) => void attributes.delete(k),
    attributes,
  };
};

describe("the theme you chose", () => {
  it("is dark until you choose, and is kept once you do", () => {
    const storage = memory();
    expect(loadTheme(storage)).toBe("dark");
    saveTheme("light", storage);
    expect(loadTheme(storage)).toBe("light");
  });

  it("keeps Dark as no choice at all", () => {
    const storage = memory();
    saveTheme("system", storage);
    saveTheme("dark", storage);
    expect(storage.items.size).toBe(0);
  });

  it("reads anything else as Dark, and refuses to save it", () => {
    const storage = memory();
    storage.setItem("tangent-reader:theme", "sepia");
    expect(loadTheme(storage)).toBe("dark");
    expect(() => saveTheme("sepia" as never, storage)).toThrow();
  });

  it("is Dark when storage refuses, or once forgotten", () => {
    const refusing = { getItem: () => { throw new Error("blocked"); }, setItem: () => {}, removeItem: () => {} };
    expect(loadTheme(refusing)).toBe("dark");
    const storage = memory();
    saveTheme("light", storage);
    forgetTheme(storage);
    expect(loadTheme(storage)).toBe("dark");
  });
});

describe("applying it", () => {
  it("marks the page for Light or the device, and leaves Dark unmarked", () => {
    const page = root();
    applyTheme("system", page);
    expect(page.attributes.get("data-theme")).toBe("system");
    applyTheme("dark", page);
    expect(page.attributes.has("data-theme")).toBe(false);
  });
});
