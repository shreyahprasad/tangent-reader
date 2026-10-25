import { describe, expect, it } from "vitest";
import { dateLabel, monthDayLabel } from "./dates";

describe("monthDayLabel and dateLabel", () => {
  it("shows a date as month and day, without depending on the time zone", () => {
    expect(monthDayLabel("2026-04-29")).toBe("Apr 29");
    expect(monthDayLabel("2026-06-01")).toBe("Jun 1");
  });

  it("adds the year for dateLabel", () => {
    expect(dateLabel("2026-06-01")).toBe("Jun 1, 2026");
  });
});

