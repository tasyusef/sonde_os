import type { NFTInfo } from "@/types/nft";

/**
 * Mobile-only sticky full-width pill for the NFT detail page. Mirrors
 * the account + token mini header pattern: a compact identity strip
 * pinned below the app nav so the user always knows what NFT they're
 * looking at while scrolling through image, stats, offers, history.
 *
 * Full NFTDetailHero (with back link, NFTokenID, trade link) renders
 * on lg+ only; this pill carries the essentials on mobile.
 */
export default function NFTMiniHeader({ nft }: { nft: NFTInfo }) {
  return (
    <div className="sticky top-[60px] z-30 -mt-3 px-4 pt-2 lg:mt-0 lg:hidden">
      <div className="flex items-center justify-between gap-3 rounded-full border border-elevated bg-surface px-3 py-1.5 shadow-card">
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded-tag bg-tx-nft/10 px-2 py-0.5 font-mono text-tag font-medium text-tx-nft">
            NFT
          </span>
          <span className="truncate font-mono text-cell font-semibold text-primary">
            #{nft.nft_serial}
          </span>
        </div>
        {nft.is_burned ? (
          <span className="shrink-0 rounded-full bg-error/8 px-2 py-0.5 font-mono text-tag font-semibold uppercase text-error">
            Burned
          </span>
        ) : (
          <span className="shrink-0 rounded-full bg-success/8 px-2 py-0.5 font-mono text-tag font-semibold uppercase text-success">
            Active
          </span>
        )}
      </div>
    </div>
  );
}
