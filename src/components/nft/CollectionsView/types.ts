/**
 * Normalized shape for an NFT in a collection grid. Both the account
 * page (XRPL `account_nfts` rows) and the portfolio page (the
 * `/api/portfolio/nfts` response) map to this before handing off to
 * `CollectionsView`.
 */
export interface NormalizedNFT {
  nftId: string;
  issuer: string;
  taxon: number;
  serial: number;
  /** Hex-encoded URI from the source. The metadata-batch endpoint
   *  decodes hex internally. Empty string when the NFT has no URI. */
  uri: string;
  /** Highest active XRP buy offer in XRP units. Only populated by
   *  consumers that have valuation data (portfolio). When absent or
   *  0, no bid pill renders on the card. */
  highestBidXrp?: number;
}

/** Per-collection aggregate values. Optional in the props — the
 *  account page doesn't surface valuations, the portfolio page does. */
export interface CollectionValuation {
  floorPriceXrp: number;
  totalValueXrp: number;
  totalValueUsd: number;
}

/** Top-of-card totals row, shown only when supplied. Portfolio uses
 *  this to show "12 NFTs · 145.2 XRP · $206". Account omits. */
export interface NFTGridTotals {
  totalCount: number;
  totalValueXrp: number;
  totalValueUsd: number;
}

export interface CollectionsViewProps {
  /** All NFTs to render, normalized. Grouping into collections happens
   *  inside the view so callers don't need to pre-bucket. */
  nfts: NormalizedNFT[];
  /** True while the upstream NFT list is still paginating (XRPL
   *  account_nfts, the portfolio API call, etc.). Surfaces as
   *  "Loading NFTs…" before any cards render. */
  loadingList?: boolean;
  /** Per-collection valuations keyed on `${issuer}:${taxon}`.
   *  When provided, collection rows show floor / total XRP / USD;
   *  individual cards show a bid pill when their own
   *  `highestBidXrp > 0`. Account omits this. */
  valuations?: Map<string, CollectionValuation>;
  /** When provided, renders a section header with title + totals
   *  above the grid. Portfolio uses this for "NFT Holdings · 145 XRP
   *  ($206)". Account omits — the grid renders without a wrapper. */
  totals?: NFTGridTotals;
  /** Heading label for the totals header. Ignored when `totals` is
   *  absent. */
  title?: string;
}
