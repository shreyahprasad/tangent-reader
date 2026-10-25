import { describe, expect, it } from "vitest";
import { enter, isImmersive, leave } from "./immersive";

describe("immersive mode", () => {
  const page = () => [{ style: { overscrollBehaviorY: "" } }, { style: { overscrollBehaviorY: "" } }];

  it("turns off pull-to-refresh on the page and its body while a sheet is open", () => {
    const [html, body] = page();
    enter([html, body]);
    expect(isImmersive()).toBe(true); // the top bar hides
    expect([html.style.overscrollBehaviorY, body.style.overscrollBehaviorY]).toEqual(["none", "none"]);
    leave([html, body]);
    expect(isImmersive()).toBe(false);
    expect([html.style.overscrollBehaviorY, body.style.overscrollBehaviorY]).toEqual(["", ""]);
  });

  it("stays on until the last asker stops", () => {
    const els = page();
    enter(els);
    enter(els);
    leave(els);
    expect(isImmersive()).toBe(true);
    expect(els[0].style.overscrollBehaviorY).toBe("none");
    leave(els);
    expect(els[0].style.overscrollBehaviorY).toBe("");
  });
});
