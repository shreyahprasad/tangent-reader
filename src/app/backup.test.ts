import { describe, expect, it } from "vitest";
import { backupName } from "./backup";

describe("a backup's name", () => {
  it("says what it is and when", () => {
    expect(backupName(new Date(2026, 9, 12, 9, 0))).toBe("tangent-reader-2026-10-12.json");
  });
});
