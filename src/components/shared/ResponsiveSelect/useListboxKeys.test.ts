import { describe, expect, it } from "vitest";
import { openFocusIndex } from "./useListboxKeys";

describe("openFocusIndex", () => {
  it("focuses the selected option whichever key opened the list", () => {
    expect(openFocusIndex("ArrowDown", 2, 4)).toBe(2);
    expect(openFocusIndex("ArrowUp", 2, 4)).toBe(2);
    expect(openFocusIndex("Enter", 0, 4)).toBe(0);
  });

  it("falls back to the first option, or the last for ArrowUp", () => {
    expect(openFocusIndex("ArrowDown", -1, 4)).toBe(0);
    expect(openFocusIndex("Enter", -1, 4)).toBe(0);
    expect(openFocusIndex("ArrowUp", -1, 4)).toBe(3);
  });

  it("ignores a selection that is out of range", () => {
    expect(openFocusIndex("ArrowDown", 7, 4)).toBe(0);
  });
});
