import { useMemo, useState } from "react";
import Toggle from "@/components/shared/Toggle";
import Section from "@/components/shared/Section";
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
import { useAccountNfts } from "@/hooks/useAccountNfts";
import { useAccountNftBids } from "@/hooks/useAccountNftBids";
import { BID_SCAN_LIMIT, incomingOfferRows } from "@/lib/nft-bids";

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
 * NFT buy offers come from `nft_buy_offers` on the account's first 50
 * NFTs (useAccountNftBids, shared with the Overview). Past 50 NFTs the
 * section says it's partial.
 */
export default function OffersTab({ address }: OffersTabProps) {
  const [view, setView] = useState<OffersView>("outgoing");

  const offersState = useAccountOffers(address);
  const objectsState = useAccountObjects(address);
  const nftsState = useAccountNfts(address);
  const bids = useAccountNftBids(nftsState.nfts);
  const incomingLoading = nftsState.isLoading || bids.isLoading;

  // XRP bids first, highest first; IOU bids after, grouped by token.
  const incomingNftOffers = useMemo<IncomingNftOffer[]>(
    () => incomingOfferRows(bids.buyOffers),
    [bids.buyOffers],
  );

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

  // Only the first 50 NFTs are scanned; say so past that. Failed
  // lookups make the list partial too.
  const totalNfts = nftsState.nfts.length;
  const incomingNote =
    totalNfts > BID_SCAN_LIMIT
      ? `Offers on the first ${BID_SCAN_LIMIT} of ${totalNfts.toLocaleString()} NFTs`
      : bids.failed > 0
        ? `Couldn't check ${bids.failed} of ${totalNfts} NFTs`
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
        <div className="space-y-12">
          <Section
            title="DEX Offers"
            count={outgoingDexOffers.length}
            status={offersState.isLoading ? "Loading DEX offers…" : null}
          >
            <OfferList offers={outgoingDexOffers as unknown as Offer[]} />
          </Section>
          <Section
            title="NFT Offers"
            count={outgoingNftOffers.length}
            status={
              objectsState.isLoading ? "Loading account objects…" : null
            }
          >
            <OutgoingNftOffersList offers={outgoingNftOffers} />
          </Section>
        </div>
      )}

      {view === "incoming" && (
        <div className="space-y-12">
          <Section
            title="NFT Buy Offers"
            count={incomingNftOffers.length}
            status={incomingLoading ? "Loading NFT buy offers…" : null}
            note={incomingNote}
          >
            <IncomingNftOffersList offers={incomingNftOffers} />
          </Section>
          <Section
            title="Checks Received"
            count={incomingChecks.length}
            status={
              objectsState.isLoading ? "Loading account objects…" : null
            }
          >
            <IncomingChecksList checks={incomingChecks} />
          </Section>
        </div>
      )}
    </div>
  );
}
