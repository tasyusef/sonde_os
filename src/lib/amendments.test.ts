import { describe, expect, it } from "vitest";
import type { VoteTally } from "./amendment-votes";
import { applyTally, groupAmendments, mergeAmendments } from "./amendments";
import { AMENDMENT_ACTIVATION } from "./xrpl-amendments";

const NFT = AMENDMENT_ACTIVATION.NonFungibleTokensV1_1;
const PENDING = "A".repeat(64);
const MAJORITY = "B".repeat(64);
const IDLE = "C".repeat(64);
const NEW = "D".repeat(64);
const LATE = "E".repeat(64);

const tally = (over: Partial<VoteTally> = {}): VoteTally => ({
  source: "data.xrpl.org",
  unl: 35,
  needed: 29,
  yes: {},
  activates: {},
  names: {},
  enabledOn: {},
  ...over,
});

describe("mergeAmendments", () => {
  it("returns an empty list when both sources are missing", () => {
    expect(mergeAmendments(null, null)).toEqual([]);
  });

  it("fills name and activation date from the registry when the node omits them", () => {
    const [row] = mergeAmendments(null, { Amendments: [NFT.id] });
    expect(row).toMatchObject({
      hash: NFT.id,
      name: "NonFungibleTokensV1_1",
      enabled: true,
      enabledAt: NFT.activationDate,
      votes: null,
    });
  });

  it("uses feature vote counts when the node reports them", () => {
    const [row] = mergeAmendments(
      { [PENDING]: { name: "Pending", enabled: false, supported: true, count: 10, threshold: 28, validations: 35 } },
      null,
    );
    expect(row.votes).toEqual({ yes: 10, of: 35, needed: 29 });
    expect(row.hasMajority).toBe(false);
  });

  it("takes the majority and its activation time from the ledger entry", () => {
    const [row] = mergeAmendments(null, { Majorities: [{ Majority: { Amendment: MAJORITY, CloseTime: 0 } }] });
    expect(row).toMatchObject({ hasMajority: true, activatesAt: "2000-01-15T00:00:00.000Z" });
  });

  it("falls back to the hash when no source names the amendment", () => {
    const [row] = mergeAmendments(null, { Amendments: [PENDING] });
    expect(row.name).toBe(PENDING);
  });
});

describe("applyTally", () => {
  const rows = mergeAmendments(
    {
      [PENDING]: { name: "Pending", enabled: false, supported: true },
      [IDLE]: { name: "Idle", enabled: false, supported: false },
    },
    { Amendments: [NFT.id, LATE], Majorities: [{ Majority: { Amendment: MAJORITY, CloseTime: 0 } }] },
  );
  const byHash = (list: typeof rows) => new Map(list.map((r) => [r.hash, r]));

  it("gives every open amendment votes, zero where none are counted", () => {
    const out = byHash(applyTally(rows, tally({ yes: { [PENDING]: 12, [MAJORITY]: 33 } })));
    expect(out.get(PENDING)?.votes).toEqual({ yes: 12, of: 35, needed: 29 });
    expect(out.get(IDLE)?.votes).toEqual({ yes: 0, of: 35, needed: 29 });
    expect(out.get(NFT.id)?.votes).toBeNull();
  });

  it("names amendments the node doesn't, and adds ones it doesn't list", () => {
    const out = byHash(
      applyTally(rows, tally({ yes: { [NEW]: 4 }, names: { [MAJORITY]: "fixCleanup", [NEW]: "Sponsor" } })),
    );
    expect(out.get(MAJORITY)?.name).toBe("fixCleanup");
    expect(out.get(NEW)).toMatchObject({ name: "Sponsor", enabled: false, votes: { yes: 4 } });
  });

  it("keeps the ledger's activation time and fills missing dates from the tally", () => {
    const out = byHash(
      applyTally(
        rows,
        tally({
          activates: { [MAJORITY]: "2030-01-01T00:00:00.000Z", [PENDING]: "2030-02-01T00:00:00.000Z" },
          enabledOn: { [NFT.id]: "2099-01-01T00:00:00.000Z", [LATE]: "2026-10-09T14:15:21.000Z" },
        }),
      ),
    );
    expect(out.get(MAJORITY)?.activatesAt).toBe("2000-01-15T00:00:00.000Z");
    expect(out.get(PENDING)).toMatchObject({ hasMajority: true, activatesAt: "2030-02-01T00:00:00.000Z" });
    expect(out.get(NFT.id)?.enabledAt).toBe(NFT.activationDate);
    expect(out.get(LATE)?.enabledAt).toBe("2026-10-09T14:15:21.000Z");
  });
});

describe("groupAmendments", () => {
  const rows = applyTally(
    mergeAmendments(
      {
        [PENDING]: { name: "Pending", enabled: false, supported: true },
        [IDLE]: { name: "Idle", enabled: false, supported: false },
        [NEW]: { name: "Ahead", enabled: false, supported: true },
      },
      { Amendments: [NFT.id, LATE], Majorities: [{ Majority: { Amendment: MAJORITY, CloseTime: 0 } }] },
    ),
    tally({ yes: { [PENDING]: 12, [NEW]: 20, [MAJORITY]: 30 }, enabledOn: { [LATE]: "2099-01-01T00:00:00.000Z" } }),
  );

  it("puts the majority first, then the most votes; idle and enabled apart", () => {
    const { voting, idle, enabled } = groupAmendments(rows);
    expect(voting.map((r) => r.hash)).toEqual([MAJORITY, NEW, PENDING]);
    expect(idle.map((r) => r.hash)).toEqual([IDLE]);
    expect(enabled.map((r) => r.hash)).toEqual([LATE, NFT.id]);
  });

  it("counts every open amendment as voting when there are no votes", () => {
    const { voting, idle } = groupAmendments(mergeAmendments({ [IDLE]: { name: "Idle", enabled: false, supported: false } }, null));
    expect(voting.map((r) => r.hash)).toEqual([IDLE]);
    expect(idle).toEqual([]);
  });
});
