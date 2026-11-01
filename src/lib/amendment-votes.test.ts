import { describe, expect, it } from "vitest";
import {
  activationFromMajority,
  neededVotes,
  parseVhsVotes,
  parseXrpscanVotes,
} from "./amendment-votes";

const OPEN = "a".repeat(64);
const MAJORITY = "B".repeat(64);
const ENABLED = "C".repeat(64);

const unl = (yes: number, others = 0) => ({
  validators: [
    ...Array.from({ length: yes }, () => ({ unl: "vl.ripple.com" })),
    ...Array.from({ length: others }, () => ({ unl: false })),
  ],
});

describe("neededVotes", () => {
  it("needs more than the threshold", () => {
    expect(neededVotes(28, 35)).toBe(29);
  });

  it("lets a one-validator UNL pass on the threshold", () => {
    expect(neededVotes(1, 1)).toBe(1);
  });
});

describe("activationFromMajority", () => {
  it("adds two weeks to a ledger close time", () => {
    expect(activationFromMajority(0)).toBe("2000-01-15T00:00:00.000Z");
    expect(activationFromMajority(845909182)).toBe("2026-11-04T14:46:22.000Z");
  });
});

describe("parseVhsVotes", () => {
  const json = {
    result: "success",
    amendments: [
      { id: OPEN, name: "Open", threshold: "28/35", voted: unl(19, 20) },
      { id: MAJORITY, name: "Majority", threshold: "28/35", eta: "2026-11-04T14:46:30.000Z", voted: unl(33) },
      { id: "D".repeat(64), name: "Unknown", obsolete: true, threshold: "28/35", voted: unl(0, 1) },
      { id: ENABLED, name: "Enabled", date: "2026-10-09T14:15:21.000Z" },
    ],
  };

  it("counts only UNL validators, and skips obsolete amendments", () => {
    const tally = parseVhsVotes(json);
    expect(tally).toMatchObject({ source: "data.xrpl.org", unl: 35, needed: 29 });
    expect(tally.yes).toEqual({ [OPEN.toUpperCase()]: 19, [MAJORITY]: 33 });
  });

  it("keeps activation times, enabled dates and every name", () => {
    const tally = parseVhsVotes(json);
    expect(tally.activates).toEqual({ [MAJORITY]: "2026-11-04T14:46:30.000Z" });
    expect(tally.enabledOn).toEqual({ [ENABLED]: "2026-10-09T14:15:21.000Z" });
    expect(tally.names[ENABLED]).toBe("Enabled");
  });

  it("skips a malformed threshold or date instead of failing", () => {
    const tally = parseVhsVotes({
      amendments: [
        { id: OPEN, threshold: "n/a", voted: unl(3) },
        { id: ENABLED, date: "not a date" },
      ],
    });
    expect(tally.yes).toEqual({});
    expect(tally.enabledOn).toEqual({});
  });

  it("throws on a response without amendments", () => {
    expect(() => parseVhsVotes({ error: "rate limited" })).toThrow();
    expect(() => parseVhsVotes(null)).toThrow();
  });
});

describe("parseXrpscanVotes", () => {
  const json = [
    { amendment_id: OPEN, name: "Open", enabled: false, count: 19, threshold: 28, validations: 35 },
    { amendment_id: MAJORITY, name: "Majority", enabled: false, count: 33, threshold: 28, validations: 35, majority: 845909182 },
    { amendment_id: "D".repeat(64), name: "Retired", enabled: false, deprecated: true, count: 0, threshold: 28, validations: 35 },
    { amendment_id: ENABLED, name: "Enabled", enabled: true, enabled_on: "2026-10-09T14:15:21.000Z" },
  ];

  it("reads counts, the UNL size and when a majority activates", () => {
    const tally = parseXrpscanVotes(json);
    expect(tally).toMatchObject({ source: "XRPScan", unl: 35, needed: 29 });
    expect(tally.yes).toEqual({ [OPEN.toUpperCase()]: 19, [MAJORITY]: 33 });
    expect(tally.activates).toEqual({ [MAJORITY]: "2026-11-04T14:46:22.000Z" });
    expect(tally.enabledOn).toEqual({ [ENABLED]: "2026-10-09T14:15:21.000Z" });
  });

  it("throws on a response that isn't a list", () => {
    expect(() => parseXrpscanVotes({ message: "error" })).toThrow();
  });
});
