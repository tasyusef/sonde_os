import { describe, expect, it } from "vitest";
import { nextBox } from "./useVisibleBox";

describe("nextBox", () => {
  it("reads the visual viewport's top and height", () => {
    expect(nextBox(null, { offsetTop: 12, height: 700 }, 800)).toEqual({ top: 12, height: 700, keyboard: false });
  });

  it("keeps the same object while nothing changes", () => {
    const prev = nextBox(null, { offsetTop: 0, height: 812 }, 812);
    expect(nextBox(prev, { offsetTop: 0, height: 812 }, 812)).toBe(prev);
  });

  it("tells a keyboard from collapsing toolbars", () => {
    // Toolbars collapsing make the visible box taller, not shorter.
    expect(nextBox(null, { offsetTop: 0, height: 900 }, 812).keyboard).toBe(false);
    expect(nextBox(null, { offsetTop: 0, height: 700 }, 812).keyboard).toBe(false);
    expect(nextBox(null, { offsetTop: 0, height: 480 }, 812).keyboard).toBe(true);
  });
});
