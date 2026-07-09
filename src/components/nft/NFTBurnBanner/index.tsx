import { getNFTHistory } from "@/lib/nft-history";
import { formatDate } from "@/lib/xrpl-helpers";
import AddressLink from "@/components/shared/AddressLink";
import HashLink from "@/components/shared/HashLink";

/** Callout rendered on burned NFT detail pages — surfaces who initiated the
 *  burn and when, pulled from the same nft_history fetch the history table
 *  uses (deduped via the shared singleflight cache key). */
export default async function NFTBurnBanner({ nftId }: { nftId: string }) {
  let burnTx;
  try {
    const history = await getNFTHistory(nftId);
    // nft_history orders newest → oldest; the burn is the most recent event.
    burnTx = history.find(
      (tx) => tx.type === "NFTokenBurn" && tx.result === "tesSUCCESS",
    );
  } catch {
    // Clio unavailable — silently omit. The "Burned" badge in the hero is
    // still shown, so the user isn't misled about burn status.
    return null;
  }

  if (!burnTx) return null;

  return (
    <div className="rounded-2xl border border-error/20 bg-error/5 shadow-card">
      <div className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-error/10 text-error"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
            </svg>
          </span>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-display text-label font-medium uppercase tracking-header text-error">
              Burned
            </span>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="font-mono text-cell text-muted">by</span>
              <AddressLink address={burnTx.account} />
              {burnTx.date != null && (
                <>
                  <span className="font-mono text-cell text-muted">on</span>
                  <span className="font-mono text-cell text-primary tabular-nums">
                    {formatDate(burnTx.date)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:shrink-0">
          <span className="font-display text-label uppercase tracking-header text-muted">
            Tx
          </span>
          <HashLink hash={burnTx.hash} />
        </div>
      </div>
    </div>
  );
}

export { NFTBurnBanner };
