import { describe, expect, it } from "vitest";
import { bitmapPath } from "./bitmap";

describe("bitmapPath", () => {
  it("draws one rect per horizontal run", () => {
    expect(bitmapPath(["##.#", ".##."])).toBe("M0 0h2v1h-2zM3 0h1v1h-1zM1 1h2v1h-2z");
  });

  it("offsets by x0 cells", () => {
    expect(bitmapPath(["#"], 6)).toBe("M6 0h1v1h-1z");
  });

  it("returns an empty path for a blank bitmap", () => {
    expect(bitmapPath(["...", ""])).toBe("");
  });
});
