"use client";

import { useMemo, useState } from "react";
import ResponsiveSelect, {
  type ResponsiveSelectOption,
} from "@/components/shared/ResponsiveSelect";
import SectionHeader from "@/components/shared/SectionHeader";
import HoldingsList from "@/components/account/HoldingsList";
import TrustLineList from "@/components/account/TrustLineList";
import EscrowList, { type Escrow } from "@/components/account/EscrowList";
import ChannelList, { type Channel } from "@/components/account/ChannelList";
import MPTokenList, {
  type MPToken,
  type MPTokenIssuance,
} from "@/components/account/MPTokenList";
import { useAccountObjects } from "@/hooks/useAccountObjects";
import { useAccountTrustLines } from "@/hooks/useAccountTrustLines";
import { useAccountAmmPositions } from "@/hooks/useAccountAmmPositions";
import { useAccountTokenPrices } from "@/hooks/useAccountTokenPrices";

type PositionsView =
  | "tokens"
  | "trustlines"
  | "escrows"
  | "channels"
  | "mptokens";

interface PositionsTabProps {
  address: string;
  xrpBalance: string;
  xrpPrice: number;
}

/**
 * Combined "Positions" tab — the account's full balance sheet + on-
 * ledger object holdings in one place.
 *
 * Sub-views (in order, conditional ones hidden when empty):
 *
 *   1. Tokens        — XRP + IOU trustlines + AMM LP rows w/ USD
 *   2. Trust Lines   — raw RippleState entries (advanced view)
 *   3. Escrows       — incoming/outgoing escrow positions (conditional)
 *   4. Channels      — payment channels (conditional)
 *   5. MPTokens      — multi-purpose tokens, nascent (conditional)
 *
 * DEX Offers used to live here too, but were promoted to their own
 * top-level "Offers" tab so we can split them by Outgoing (this account
 * placed) vs Incoming (NFT buy offers + Checks targeting this account).
 *
 * AMM positions render inline in Tokens with full LP composition + USD
 * value via HoldingsList — no standalone AMM sub-view.
 *
 * Tier 2 migration: this tab owns its data via four hooks
 * (useAccountObjects, useAccountTrustLines, useAccountAmmPositions,
 * useAccountTokenPrices). Trustlines come from CH (`trustlines` mirror,
 * 2026-05-09); other ledger entries still walk rippled `account_objects`.
 * Sub-views narrate their own loading via SectionHeader.
 */
export default function PositionsTab({
  address,
  xrpBalance,
  xrpPrice,
}: PositionsTabProps) {
  const objectsState = useAccountObjects(address);
  const trustLinesState = useAccountTrustLines(address);
  const ammState = useAccountAmmPositions(
    trustLinesState.lpTrustLines,
    address,
  );
  const pricesState = useAccountTokenPrices(
    trustLinesState.regularTrustLines,
    address,
  );

  const trustLines = trustLinesState.regularTrustLines;
  const allTrustLines = trustLinesState.allTrustLines;
  const ammPositions = ammState.ammPositions;
  const tokenPriceMap = pricesState.tokenPriceMap;
  const escrows = objectsState.escrows;
  const channels = objectsState.channels;
  const mpTokens = objectsState.mpTokens;
  const mpTokenIssuances = objectsState.mpTokenIssuances;

  const trustLineCount = allTrustLines.length;
  const escrowsCount = escrows.length;
  const channelsCount = channels.length;
  const mpTokenCount = mpTokens.length + mpTokenIssuances.length;

  const options = useMemo<ResponsiveSelectOption<PositionsView>[]>(() => {
    const labelWithCount = (
      base: string,
      count: number,
    ): ResponsiveSelectOption<PositionsView>["desktopLabel"] => (
      <>
        {base} <span className="opacity-60">({count})</span>
      </>
    );
    const items: ResponsiveSelectOption<PositionsView>[] = [
      // Tokens always visible — every account has at least XRP.
      { value: "tokens", label: "Tokens" },
      {
        value: "trustlines",
        label: "Trust Lines",
        desktopLabel:
          trustLineCount > 0
            ? labelWithCount("Trust Lines", trustLineCount)
            : "Trust Lines",
      },
    ];
    if (escrowsCount > 0) {
      items.push({
        value: "escrows",
        label: "Escrows",
        desktopLabel: labelWithCount("Escrows", escrowsCount),
      });
    }
    if (channelsCount > 0) {
      items.push({
        value: "channels",
        label: "Channels",
        desktopLabel: labelWithCount("Channels", channelsCount),
      });
    }
    if (mpTokenCount > 0) {
      items.push({
        value: "mptokens",
        label: "MPTokens",
        desktopLabel: labelWithCount("MPTokens", mpTokenCount),
      });
    }
    return items;
  }, [trustLineCount, escrowsCount, channelsCount, mpTokenCount]);

  const [view, setView] = useState<PositionsView>("tokens");

  // Derived effective view — same pattern used elsewhere to dodge
  // setState-in-effect. If `view` falls out of options (revalidation
  // dropped it), display the first available without a re-render
  // setState dance.
  const effectiveView: PositionsView = options.some(
    (o) => o.value === view,
  )
    ? view
    : (options[0]?.value ?? view);

  // Tokens-view status cascades through three hooks chained on
  // trustlines. Only the active leg gets named; once everything settles,
  // we fall through to the live-refresh state (POST /refresh fires
  // alongside the initial CH read on every mount). When everything is
  // idle, no status — header reads as a static label.
  // (escrow/channel hooks use `objectsState.isLoading` for their own
  // subviews — kept separate.)
  const tokensStatus = trustLinesState.isLoading
    ? `Loading ${trustLineCount > 0 ? `${trustLineCount} ` : ""}trustlines…`
    : pricesState.isLoading
      ? `Pricing ${trustLines.length} tokens…`
      : ammState.isLoading
        ? `Fetching ${trustLinesState.lpTrustLines.length} AMM positions…`
        : trustLinesState.isRefreshing
          ? "Refreshing live balances…"
          : null;

  const trustLinesStatus = trustLinesState.isLoading
    ? "Loading trustlines…"
    : trustLinesState.isRefreshing
      ? "Refreshing live balances…"
      : null;

  return (
    <div className="space-y-2">
      <div className="flex min-h-6 items-center justify-end">
        <ResponsiveSelect
          options={options}
          active={effectiveView}
          onChange={setView}
          ariaLabel="Positions view"
          desktopVariant="select"
        />
      </div>

      {effectiveView === "tokens" && (
        <div className="space-y-3">
          <SectionHeader title="Tokens" status={tokensStatus} />
          <HoldingsList
            address={address}
            xrpBalance={xrpBalance}
            xrpPrice={xrpPrice}
            trustLines={trustLines}
            ammPositions={ammPositions}
            tokenPriceMap={tokenPriceMap}
          />
        </div>
      )}

      {effectiveView === "trustlines" && (
        <div className="space-y-3">
          <SectionHeader
            title="Trust Lines"
            count={trustLineCount}
            status={trustLinesStatus}
          />
          <TrustLineList trustLines={allTrustLines} address={address} />
        </div>
      )}

      {effectiveView === "escrows" && (
        <div className="space-y-3">
          <SectionHeader
            title="Escrows"
            count={escrowsCount}
            status={
              objectsState.isLoading ? "Loading account objects…" : null
            }
          />
          <EscrowList escrows={escrows as unknown as Escrow[]} />
        </div>
      )}

      {effectiveView === "channels" && (
        <div className="space-y-3">
          <SectionHeader
            title="Channels"
            count={channelsCount}
            status={
              objectsState.isLoading ? "Loading account objects…" : null
            }
          />
          <ChannelList channels={channels as unknown as Channel[]} />
        </div>
      )}

      {effectiveView === "mptokens" && (
        <div className="space-y-3">
          <SectionHeader
            title="MPTokens"
            count={mpTokenCount}
            status={
              objectsState.isLoading ? "Loading account objects…" : null
            }
          />
          <MPTokenList
            mpTokens={mpTokens as unknown as MPToken[]}
            mpTokenIssuances={mpTokenIssuances as unknown as MPTokenIssuance[]}
          />
        </div>
      )}
    </div>
  );
}
