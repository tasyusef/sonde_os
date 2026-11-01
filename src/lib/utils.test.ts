import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cn, TEXT_SIZES } from "./utils";

const css = readFileSync(fileURLToPath(new URL("../globals.css", import.meta.url)), "utf8");

describe("cn", () => {
  it("knows every text size token in globals.css", () => {
    const tokens = [...css.matchAll(/--text-([a-z0-9-]+?):/g)]
      .map((m) => m[1])
      .filter((name) => !name.endsWith("--line-height"));
    expect([...new Set(tokens)].sort()).toEqual([...TEXT_SIZES].sort());
  });

  it("keeps a colour beside a size token", () => {
    for (const size of TEXT_SIZES) {
      expect(cn("text-on-accent", `text-${size}`)).toBe(`text-on-accent text-${size}`);
    }
  });

  it("still lets a later size or colour win", () => {
    expect(cn("text-caps", "text-body")).toBe("text-body");
    expect(cn("text-primary", "text-on-accent")).toBe("text-on-accent");
  });
});
