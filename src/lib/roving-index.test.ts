import { describe, expect, it } from "vitest";
import { rovingIndex } from "./roving-index";

const tabs = { orientation: "horizontal", wrap: true } as const;
const listbox = { orientation: "vertical", wrap: false } as const;
const radios = { orientation: "both", wrap: true } as const;

describe("rovingIndex", () => {
  it("moves and wraps along the horizontal axis for tabs", () => {
    expect(rovingIndex("ArrowRight", 1, 4, tabs)).toBe(2);
    expect(rovingIndex("ArrowRight", 3, 4, tabs)).toBe(0);
    expect(rovingIndex("ArrowLeft", 0, 4, tabs)).toBe(3);
    expect(rovingIndex("ArrowLeft", 2, 4, tabs)).toBe(1);
  });

  it("ignores the cross axis", () => {
    expect(rovingIndex("ArrowDown", 1, 4, tabs)).toBeNull();
    expect(rovingIndex("ArrowUp", 1, 4, tabs)).toBeNull();
    expect(rovingIndex("ArrowRight", 1, 4, listbox)).toBeNull();
    expect(rovingIndex("ArrowLeft", 1, 4, listbox)).toBeNull();
  });

  it("stops at the ends without wrap (listbox)", () => {
    expect(rovingIndex("ArrowDown", 1, 3, listbox)).toBe(2);
    expect(rovingIndex("ArrowDown", 2, 3, listbox)).toBe(2);
    expect(rovingIndex("ArrowUp", 0, 3, listbox)).toBe(0);
  });

  it("accepts both axes for radio groups", () => {
    expect(rovingIndex("ArrowRight", 0, 3, radios)).toBe(1);
    expect(rovingIndex("ArrowDown", 0, 3, radios)).toBe(1);
    expect(rovingIndex("ArrowLeft", 0, 3, radios)).toBe(2);
    expect(rovingIndex("ArrowUp", 0, 3, radios)).toBe(2);
  });

  it("jumps to the ends on Home and End", () => {
    expect(rovingIndex("Home", 2, 4, tabs)).toBe(0);
    expect(rovingIndex("End", 0, 4, listbox)).toBe(3);
  });

  it("enters from the matching end when nothing is focused", () => {
    expect(rovingIndex("ArrowRight", -1, 4, tabs)).toBe(0);
    expect(rovingIndex("ArrowLeft", -1, 4, tabs)).toBe(3);
    expect(rovingIndex("ArrowUp", -1, 4, listbox)).toBe(3);
  });

  it("returns null for other keys and empty widgets", () => {
    expect(rovingIndex("Enter", 1, 4, tabs)).toBeNull();
    expect(rovingIndex("a", 1, 4, listbox)).toBeNull();
    expect(rovingIndex("ArrowRight", 0, 0, tabs)).toBeNull();
    expect(rovingIndex("Home", 0, 0, tabs)).toBeNull();
  });
});
