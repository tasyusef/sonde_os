"use client";

import Link from "next/link";
import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import AddressLink from "@/components/shared/AddressLink";
import HashLink from "@/components/shared/HashLink";
import { formatDate, truncate } from "@/lib/xrpl-helpers";

/* ──────────────────────────────────────────────────────────────────
 * BurnedNFTsList — every NFTokenBurn this account initiated.
 *
 * Pre-2026-05-08, this component derived burns from whatever slice of
 * tx history was currently loaded into AccountDataClient. For an
 * account with thousands of txs and a handful of burns, that meant
 * the user clicked "Load More Transactions" many times before any
 * burn appeared — and the empty state that showed up first was a wall
 * of text with the same dead "Load More" button. Confusing.
 *
 * Now: fetches `/api/account/[address]/nft-burns` directly. The CH
 * query is bounded to NFTokenBurn rows for this account, returns the
 * full set in one shot (capped at 500), and is independent of any
 * other pagination on the page.
 *
 * Scope: ONLY burns this account directly initiated. NFTs minted by
 * this account but burned later by a holder live in the holder's tx
 * history and are intentionally not surfaced here — mixing them in
 * confused users into thinking the issuer was the burner.
 * ────────────────────────────────────────────────────────────────── */

interface BurnRow {
  nftId: string;
  hash: string;
  timestamp: string;
  xrpl_date: number;
  taxon: number | null;
  serial: number | null;
  issuer: string | null;
}

interface ApiResponse {
  burns: BurnRow[];
  error?: string;
}

/** Count NFTokenBurn transactions initiated by this account in the given
 *  transaction set. Used by AccountTabs to decide tab visibility + badge.
 *  Kept as a sync helper since it operates on already-loaded txs. */
export function countAccountBurns(
  transactions: { tx: Record<string, unknown>; meta: Record<string, unknown> }[],
  address: string,
): number {
  let n = 0;
  const seen = new Set<string>();
  for (const item of transactions) {
    const tx = item.tx;
    if ((tx.TransactionType as string) !== "NFTokenBurn") continue;
    if ((tx.Account as string) !== address) continue;
    if ((item.meta.TransactionResult as string) !== "tesSUCCESS") continue;
    const hash = (tx.hash as string) ?? "";
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    n++;
  }
  return n;
}

interface Props {
  address: string;
}

export default function BurnedNFTsList({ address }: Props) {
  const { data, isLoading, error } = useSWR<ApiResponse>(
    `/api/account/${address}/nft-burns`,
    fetcher,
    { revalidateOnFocus: false },
  );

  if (isLoading) {
    return (
      <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-cell text-muted">Loading burns…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div role="alert" className="rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-cell text-error">Couldn&apos;t load burns.</p>
        <p className="mt-1 font-mono text-tag text-muted">Try refreshing the page.</p>
      </div>
    );
  }

  const burns = data.burns;

  if (burns.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-8 text-center shadow-card">
        <p className="font-mono text-body text-muted">
          This account has not initiated any NFT burns.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header row — count of self-initiated burns only. */}
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          Burns Initiated
          <span className="ml-1.5 text-muted">({burns.length})</span>
        </span>
      </div>

      {/* Card grid. Two columns on tablet, three on desktop, one on
          mobile. Each card carries the identifying NFT metadata + a
          link to the per-NFT detail page where image + URI render. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {burns.map((burn) => (
          <BurnCard key={burn.hash} burn={burn} />
        ))}
      </div>
    </div>
  );
}

function BurnCard({ burn }: { burn: BurnRow }) {
  return (
    <Link
      href={`/nft/${burn.nftId}`}
      className="group block rounded-2xl bg-surface p-4 shadow-card transition-shadow hover:shadow-card-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-cell font-medium text-brand transition-colors group-hover:text-brand-light">
          {truncate(burn.nftId, 6)}
        </span>
        <span className="rounded-tag bg-tx-nft/10 px-1.5 py-0.5 font-mono text-micro font-semibold uppercase tracking-pill text-tx-nft">
          NFT
        </span>
      </div>

      <dl className="mt-3 space-y-1.5 font-mono text-tag">
        {burn.taxon != null && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Taxon</dt>
            <dd className="tabular-nums text-secondary">{burn.taxon}</dd>
          </div>
        )}
        {burn.serial != null && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Serial</dt>
            <dd className="tabular-nums text-secondary">#{burn.serial}</dd>
          </div>
        )}
        {burn.issuer && (
          <div className="flex items-baseline justify-between gap-2">
            <dt className="text-muted">Issuer</dt>
            <dd onClick={(e) => e.stopPropagation()}>
              <AddressLink address={burn.issuer} chars={4} />
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-muted">Burned</dt>
          <dd className="text-secondary">
            {burn.xrpl_date ? formatDate(burn.xrpl_date) : "—"}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted">Tx</dt>
          <dd onClick={(e) => e.stopPropagation()}>
            <HashLink hash={burn.hash} />
          </dd>
        </div>
      </dl>
    </Link>
  );
}

export { BurnedNFTsList };
