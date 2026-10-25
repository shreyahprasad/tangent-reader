import { describe, expect, it } from "vitest";
import { lastFour, loadKey, removeKey, saveKey, type Places } from "./key";

const KEY = "sk-ant-api03-made-up-for-tests-WXYZ";

/** A Storage in memory. */
function memory(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    key: (i) => [...items.keys()][i] ?? null,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
    removeItem: (k) => void items.delete(k),
    clear: () => items.clear(),
  };
}

const places = () => {
  const p: Places = { tab: memory(), device: memory() };
  return () => p;
};
const blocked = () => {
  throw new DOMException("The operation is insecure.", "SecurityError");
};

describe("where the key is kept", () => {
  it("is this tab only, or this device, and never both", () => {
    const p = places();
    expect(loadKey(p)).toBeNull();
    saveKey(` ${KEY} `, "device", p);
    expect(loadKey(p)).toEqual({ key: KEY, keep: "device" });
    saveKey(KEY, "tab", p);
    expect(loadKey(p)).toEqual({ key: KEY, keep: "tab" });
    expect(p().device.length).toBe(0);
  });

  it("can be removed from everywhere", () => {
    const p = places();
    saveKey(KEY, "device", p);
    removeKey(p);
    expect(loadKey(p)).toBeNull();
  });

  it("is simply missing when this browser blocks site data, and saving it says so", () => {
    expect(loadKey(blocked)).toBeNull();
    expect(() => saveKey(KEY, "tab", blocked)).toThrow("insecure");
  });

  it("shows only its last four characters", () => {
    expect(lastFour(KEY)).toBe("WXYZ");
  });
});
