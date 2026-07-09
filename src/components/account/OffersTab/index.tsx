"use client";

import { useMemo, useState } from "react";
import Toggle from "@/components/shared/Toggle";
import SectionHeader from "@/components/shared/SectionHeader";
import OfferList, { type Offer } from "@/components/account/OfferList";
import OutgoingNftOffersList, {
  type OutgoingNftOffer,
} from "@/components/account/OutgoingNftOffersList";
import IncomingNftOffersList, {
  type IncomingNftOffer,
} from "@/components/account/IncomingNftOffersList";
import IncomingChecksList, {
  type IncomingCheck,
} from "@/components/account/IncomingChecksList";
import { useAccountOffers } from "@/hooks/useAccountOffers";
import { useAccountObjects } from "@/hooks/useAccountObjects";
import { useAccountIncomingNftOffers } from "@/hooks/useAccountIncomingNftOffers";

type OffersView = "outgoing" | "incoming";

interface OffersTabProps {
  address: string;
}

/**
 * Offers — promoted from a sub-view inside Positions to a top-level tab.
 *
 *   - Outgoing: offers this account has placed.
 *       • DEX offers (account_offers — XRPL order-book limit orders)
 *       • NFT offers (account_objects → NFTokenOffer entries — sell
 *         offers on this account's own NFTs + buy offers on others')
 *   - Incoming: offers OTHER accounts have placed targeting this account
 *     — NFT buy offers received on this account's NFTs, and Check ledger
 *     entries with Destination = this account.
 *
 * The Outgoing/Incoming split mirrors the user's mental model — "what
 * I'm offering" vs "what's coming at me." Inside Incoming, NFT buy
 * offers and Checks render as separate sections so two distinct data
 * shapes don't get crammed into one table.
 *
 * NFT buy offers are fetched via a server-side aggregation endpoint
 * that scans up to 500 NFTs and caches the result at the edge —
 * faster and more exhaustive than the old browser fan-out which was
 * capped at 50.
 */
export default function OffersTab({ address }: OffersTabProps) {
  const [view, setView] = useState<OffersView>("outgoing");

  const offersState = useAccountOffers(address);
  const objectsState = useAccountObjects(address);
  const incomingNftState = useAccountIncomingNftOffers(address);

  // Sort highest-amount first — most actionable bids at the top.
  const incomingNftOffers = useMemo<IncomingNftOffer[]>(() => {
    return [...incomingNftState.offers].sort(
      (a, b) => offerAmountValue(b.offer) - offerAmountValue(a.offer),
    );
  }, [incomingNftState.offers]);

  // Filter checks — Destination = this account.
  const incomingChecks = useMemo<IncomingCheck[]>(() => {
    return objectsState.objects.filter(
      (o) =>
        o.LedgerEntryType === "Check" &&
        (o as { Destination?: string }).Destination === address,
    ) as unknown as IncomingCheck[];
  }, [objectsState.objects, address]);

  // Outgoing NFT offers — NFTokenOffer ledger entries owned by this
  // account. account_objects only returns objects this account owns,
  // so the type filter is sufficient (no Owner check needed). Newest
  // first by ledger sequence so recently-placed offers surface on top.
  const outgoingNftOffers = useMemo<OutgoingNftOffer[]>(() => {
    const filtered = objectsState.objects.filter(
      (o) => o.LedgerEntryType === "NFTokenOffer",
    ) as unknown as (OutgoingNftOffer & { PreviousTxnLgrSeq?: number })[];
    return [...filtered].sort(
      (a, b) => (b.PreviousTxnLgrSeq ?? 0) - (a.PreviousTxnLgrSeq ?? 0),
    );
  }, [objectsState.objects]);

  const outgoingDexOffers = offersState.offers;
  const outgoingCount = outgoingDexOffers.length + outgoingNftOffers.length;
  const incomingCount = incomingNftOffers.length + incomingChecks.length;

  // Surface the truncation note only when the server actually capped
  // the scan (account holds more NFTs than the endpoint scans, currently
  // 500). Below that, coverage is exhaustive.
  const truncationNote = incomingNftState.truncated
    ? `Showing offers on first ${incomingNftState.scannedNfts.toLocaleString()} of ${incomingNftState.totalNfts.toLocaleString()} NFTs`
    : null;

  return (
    <div className="space-y-2">
      <div className="flex min-h-6 items-center justify-end">
        <Toggle
          options={[
            {
              value: "outgoing",
              label:
                outgoingCount > 0
                  ? `Outgoing (${outgoingCount})`
                  : "Outgoing",
            },
            {
              value: "incoming",
              label:
                incomingCount > 0
                  ? `Incoming (${incomingCount})`
                  : "Incoming",
            },
          ]}
          active={view}
          onChange={setView}
          ariaLabel="Offers view"
        />
      </div>

      {view === "outgoing" && (
        <div className="space-y-6">
          <div className="space-y-3">
            <SectionHeader
              title="DEX Offers"
              count={outgoingDexOffers.length}
              status={offersState.isLoading ? "Loading DEX offers…" : null}
            />
            <OfferList offers={outgoingDexOffers as unknown as Offer[]} />
          </div>
          <div className="space-y-3">
            <SectionHeader
              title="NFT Offers"
              count={outgoingNftOffers.length}
              status={
                objectsState.isLoading ? "Loading account objects…" : null
              }
            />
            <OutgoingNftOffersList offers={outgoingNftOffers} />
          </div>
        </div>
      )}

      {view === "incoming" && (
        <div className="space-y-6">
          <div className="space-y-3">
            <SectionHeader
              title="NFT Buy Offers"
              count={incomingNftOffers.length}
              status={
                incomingNftState.isLoading
                  ? "Loading NFT buy offers…"
                  : truncationNote
              }
            />
            <IncomingNftOffersList offers={incomingNftOffers} />
          </div>
          <div className="space-y-3">
            <SectionHeader
              title="Checks Received"
              count={incomingChecks.length}
              status={
                objectsState.isLoading ? "Loading account objects…" : null
              }
            />
            <IncomingChecksList checks={incomingChecks} />
          </div>
        </div>
      )}
    </div>
  );
}

/** XRP-equivalent value for sorting. IOU bids without price data fall to
 *  zero so they end up at the bottom of the list rather than being
 *  hidden — a partial signal beats nothing. */
function offerAmountValue(offer: IncomingNftOffer["offer"]): number {
  if (typeof offer.amount === "string") {
    return parseFloat(offer.amount);
  }
  return parseFloat(offer.amount.value);
}
