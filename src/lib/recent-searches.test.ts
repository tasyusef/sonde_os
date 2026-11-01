import { describe, expect, it } from "vitest";
import { RECENT_MAX, addRecent, parseRecent } from "./recent-searches";
import type { SearchHit } from "./search";

const hit = (id: string, kind: SearchHit["kind"] = "account"): SearchHit => ({ kind, id });

describe("parseRecent", () => {
  it("reads what was stored", () => {
    const hits = [hit("rA"), hit("1", "ledger")];
    expect(parseRecent(JSON.stringify(hits))).toEqual(hits);
  });

  it("falls back to none for missing or broken storage", () => {
    for (const raw of [null, "", "{", "{}", "42"]) expect(parseRecent(raw)).toEqual([]);
  });

  it("drops malformed entries and duplicates", () => {
    const raw = JSON.stringify([
      hit("rA"),
      { kind: "wallet", id: "rB" },
      { kind: "account", id: "" },
      { kind: "account" },
      null,
      hit("rA"),
      hit("rA", "transaction"),
    ]);
    expect(parseRecent(raw)).toEqual([hit("rA"), hit("rA", "transaction")]);
  });

  it(`keeps at most ${RECENT_MAX}`, () => {
    const many = Array.from({ length: RECENT_MAX + 3 }, (_, i) => hit(`r${i}`));
    expect(parseRecent(JSON.stringify(many))).toEqual(many.slice(0, RECENT_MAX));
  });
});

describe("addRecent", () => {
  it("puts the newest first", () => {
    expect(addRecent([hit("rA")], hit("rB"))).toEqual([hit("rB"), hit("rA")]);
  });

  it("moves a repeat to the top instead of listing it twice", () => {
    expect(addRecent([hit("rA"), hit("rB"), hit("rC")], hit("rC"))).toEqual([
      hit("rC"),
      hit("rA"),
      hit("rB"),
    ]);
  });

  it("returns the same list when the hit is already first", () => {
    const hits = [hit("rA"), hit("rB")];
    expect(addRecent(hits, hit("rA"))).toBe(hits);
  });

  it(`drops the oldest past ${RECENT_MAX}`, () => {
    const full = Array.from({ length: RECENT_MAX }, (_, i) => hit(`r${i}`));
    const next = addRecent(full, hit("rNew"));
    expect(next).toHaveLength(RECENT_MAX);
    expect(next[0]).toEqual(hit("rNew"));
    expect(next).not.toContainEqual(full[RECENT_MAX - 1]);
  });
});
