import Section from "@/components/shared/Section";
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
import { AMM_LOOKUP_CAP, useAccountAmmPositions } from "@/hooks/useAccountAmmPositions";
import { OBJECT_CAP } from "@/lib/account-objects";

interface PositionsTabProps {
  address: string;
  xrpBalance: string;
  xrpPrice: number;
}

/**
 * The account's balance sheet and on-ledger holdings, stacked:
 *
 *   Tokens       XRP, IOU trust lines and AMM LP positions (always)
 *   Escrows      incoming and outgoing (when any)
 *   Channels     payment channels (when any)
 *   MPTokens     multi-purpose tokens (when any)
 *   Trust Lines  the raw RippleState entries behind Tokens (when any)
 *
 * Owns its data via three hooks (useAccountObjects, useAccountTrustLines,
 * useAccountAmmPositions), all over the browser WebSocket. Trust lines
 * render page by page as `account_objects` pages arrive. Each section
 * narrates its own loading in its `<Section>` heading.
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

  const trustLines = trustLinesState.regularTrustLines;
  const allTrustLines = trustLinesState.allTrustLines;
  const ammPositions = ammState.ammPositions;
  const escrows = objectsState.escrows;
  const channels = objectsState.channels;
  const mpTokens = objectsState.mpTokens;
  const mpTokenIssuances = objectsState.mpTokenIssuances;

  const trustLineCount = allTrustLines.length;
  const escrowsCount = escrows.length;
  const channelsCount = channels.length;
  const mpTokenCount = mpTokens.length + mpTokenIssuances.length;

  // Status narrates the active leg (trust lines, then AMM lookups);
  // the note carries what's left once everything settles.
  const linesStatus = trustLinesState.isLoading
    ? `Loading ${trustLineCount > 0 ? `${trustLineCount.toLocaleString()} ` : ""}trust lines…`
    : null;
  const tokensStatus =
    linesStatus ??
    (ammState.isLoading
      ? `Fetching ${Math.min(trustLinesState.lpTrustLines.length, AMM_LOOKUP_CAP)} AMM positions…`
      : null);
  const linesFailed = trustLinesState.error !== undefined;
  const linesNote = trustLinesState.partial
    ? "Couldn't load all trust lines"
    : trustLinesState.truncated
      ? `Only the first ${OBJECT_CAP.toLocaleString()} ledger objects loaded`
      : null;
  const tokensAlert = linesFailed
    ? { message: "Couldn't load trust lines", onRetry: trustLinesState.retry }
    : ammState.error !== undefined
      ? { message: "Couldn't load AMM positions", onRetry: ammState.retry }
      : null;
  const ammNote = ammState.partial
    ? "Couldn't load all AMM positions"
    : ammState.capped
      ? `Only the first ${AMM_LOOKUP_CAP} AMM positions loaded`
      : null;
  const tokensNote = [linesNote, ammNote].filter(Boolean).join(" · ") || null;

  const objectsStatus = objectsState.isLoading ? "Loading account objects…" : null;

  return (
    <div className="space-y-12">
      <Section title="Tokens" status={tokensStatus} note={tokensNote} alert={tokensAlert}>
        <HoldingsList
          address={address}
          xrpBalance={xrpBalance}
          xrpPrice={xrpPrice}
          trustLines={trustLines}
          ammPositions={ammPositions}
        />
      </Section>

      {escrowsCount > 0 && (
        <Section title="Escrows" count={escrowsCount} status={objectsStatus}>
          <EscrowList escrows={escrows as unknown as Escrow[]} />
        </Section>
      )}

      {channelsCount > 0 && (
        <Section title="Channels" count={channelsCount} status={objectsStatus}>
          <ChannelList channels={channels as unknown as Channel[]} />
        </Section>
      )}

      {mpTokenCount > 0 && (
        <Section title="MPTokens" count={mpTokenCount} status={objectsStatus}>
          <MPTokenList
            mpTokens={mpTokens as unknown as MPToken[]}
            mpTokenIssuances={mpTokenIssuances as unknown as MPTokenIssuance[]}
          />
        </Section>
      )}

      {/* A failed load is already flagged on Tokens. */}
      {trustLineCount > 0 && (
        <Section title="Trust Lines" count={trustLineCount} status={linesStatus} note={linesNote}>
          <TrustLineList trustLines={allTrustLines} address={address} />
        </Section>
      )}
    </div>
  );
}
