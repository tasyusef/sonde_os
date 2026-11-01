/**
 * The overview's Total Value: XRP balance plus the XRP-priced parts the
 * tabs load (XRP-paired AMM positions, escrowed XRP, unclaimed channel
 * XRP, the highest XRP bid on each NFT). Issued tokens have no price
 * feed, so they're left out. When a source didn't fully load, the total
 * is a lower bound and its note says "partial".
 */

import type { AMMPosition } from "@/types/amm";
import type { LedgerObject } from "./account-objects";
import { lpPositionXrpValue } from "./amm-helpers";
import { BID_SCAN_LIMIT } from "./nft-bids";
import { dropsToXrp } from "./xrpl-helpers";

/** How a source the total reads from finished. */
export interface SourceState {
  /** Failed with nothing loaded. */
  error?: unknown;
  /** A page or item failed after others loaded. */
  partial?: boolean;
  /** Stopped at a cap with more left. */
  truncated?: boolean;
}

export interface TotalValueSources {
  /** account_objects: escrows, channels, trust lines. */
  objects: SourceState;
  amm: SourceState & { capped: boolean };
  nfts: SourceState & { count: number };
  /** NFTs whose `nft_buy_offers` failed. */
  bidsFailed: number;
}

interface TrustLineLike {
  Balance?: { value?: string };
  HighLimit?: { issuer?: string };
}

export interface TotalValueInput {
  address: string;
  xrpValueUsd: number;
  xrpPrice: number;
  escrows: readonly LedgerObject[];
  channels: readonly LedgerObject[];
  ammPositions: readonly AMMPosition[];
  /** NFTokenID → highest XRP bid, in XRP. */
  highestBids: Record<string, number>;
  /** Non-LP trust lines. */
  trustLines: readonly TrustLineLike[];
  sources: TotalValueSources;
}

export interface TotalValue {
  valueUsd: number;
  /** "partial", "excl. tokens", both, or undefined. */
  note: string | undefined;
}

const unfinished = (s: SourceState) => s.error !== undefined || !!s.partial || !!s.truncated;

/** Some part of the total couldn't be read, so it's a lower bound. */
export function totalValueIncomplete(s: TotalValueSources): boolean {
  return (
    unfinished(s.objects) ||
    unfinished(s.amm) ||
    s.amm.capped ||
    unfinished(s.nfts) ||
    s.nfts.count > BID_SCAN_LIMIT ||
    s.bidsFailed > 0
  );
}

export function accountTotalValue(input: TotalValueInput): TotalValue {
  const { address } = input;
  let otherXrp = 0;
  for (const pos of input.ammPositions) otherXrp += lpPositionXrpValue(pos) ?? 0;
  for (const esc of input.escrows) {
    const amount = esc.Amount;
    // Only the escrows it sent: an incoming one is still the sender's
    // XRP. An IOU escrow's Amount is an object; only XRP counts.
    if (esc.Account === address && typeof amount === "string") otherXrp += parseFloat(dropsToXrp(amount));
  }
  for (const ch of input.channels) {
    if (ch.Account !== address || typeof ch.Amount !== "string") continue;
    const claimed = typeof ch.Balance === "string" ? BigInt(ch.Balance) : 0n;
    const remaining = BigInt(ch.Amount) - claimed;
    if (remaining > 0n) otherXrp += parseFloat(dropsToXrp(remaining.toString()));
  }
  for (const xrp of Object.values(input.highestBids)) otherXrp += xrp;

  const holdsTokens = input.trustLines.some((tl) => {
    const balance = parseFloat(tl.Balance?.value ?? "0");
    return (tl.HighLimit?.issuer === address ? -balance : balance) > 0;
  });
  const note =
    [totalValueIncomplete(input.sources) && "partial", holdsTokens && "excl. tokens"]
      .filter(Boolean)
      .join(" · ") || undefined;

  return { valueUsd: input.xrpValueUsd + otherXrp * input.xrpPrice, note };
}
