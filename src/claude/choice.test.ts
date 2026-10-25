import { describe, expect, it } from "vitest";
import { forgetModel, loadModel, saveModel } from "./choice";
import { DEFAULT_MODEL, HAIKU } from "./models";

const memory = () => {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    items,
  };
};

describe("the model you chose", () => {
  it("is the default until you choose, and kept once you do", () => {
    const storage = memory();
    expect(loadModel(storage)).toBe(DEFAULT_MODEL);
    saveModel(HAIKU, storage);
    expect(loadModel(storage)).toBe(HAIKU);
  });

  it("keeps the default as no choice, so a new default reaches you", () => {
    const storage = memory();
    saveModel(HAIKU, storage);
    saveModel(DEFAULT_MODEL, storage);
    expect(storage.items.size).toBe(0);
  });

  it("reads one this page no longer offers as the default, and refuses to save one", () => {
    const storage = memory();
    storage.setItem("tangent-reader:model", "claude-retired-1");
    expect(loadModel(storage)).toBe(DEFAULT_MODEL);
    expect(() => saveModel("claude-retired-1", storage)).toThrow();
  });

  it("is the default when storage refuses, or once forgotten", () => {
    const refusing = { getItem: () => { throw new Error("blocked"); }, setItem: () => {}, removeItem: () => {} };
    expect(loadModel(refusing)).toBe(DEFAULT_MODEL);
    const storage = memory();
    saveModel(HAIKU, storage);
    forgetModel(storage);
    expect(loadModel(storage)).toBe(DEFAULT_MODEL);
  });
});
