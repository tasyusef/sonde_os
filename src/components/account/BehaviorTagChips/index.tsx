import type { BehaviorTag } from "@/lib/clickhouse-queries";

/**
 * Free-tier behavior chips. Compact horizontal row showing what an
 * account "is" — DEX trader, AMM LP, NFT collector, etc. — derived in
 * real time from CH via `getLiveBehaviorTags`.
 *
 * Each tag is purely descriptive. Threshold-based, conservative —
 * false-positives read worse than false-negatives ("this account is
 * an AMM LP" when they did one tiny deposit two years ago feels
 * misleading).
 *
 * Returns null when there are no tags so the strip collapses cleanly
 * for fresh / inactive accounts.
 */
interface Props {
  tags: BehaviorTag[];
}

const TAG_LABELS: Record<BehaviorTag, string> = {
  dex_trader: "DEX Trader",
  liquidity_provider: "AMM LP",
  nft_collector: "NFT Collector",
  nft_creator: "NFT Creator",
  cross_currency_payer: "Cross-Currency",
  // Identity tags from `account_labels` (written by the smart-money
  // scorer). Whale = recent volume threshold; Validator = known UNL.
  whale: "Whale",
  validator: "Validator",
};

const TAG_COLORS: Record<BehaviorTag, string> = {
  // Map each tag to an existing tx-type token so the chip palette
  // visually rhymes with the rest of the explorer (transaction lists,
  // type tags). Picks intentional, not arbitrary.
  dex_trader: "bg-tx-offer/10 text-tx-offer border-tx-offer/30",
  liquidity_provider: "bg-tx-amm/10 text-tx-amm border-tx-amm/30",
  nft_collector: "bg-tx-nft/10 text-tx-nft border-tx-nft/30",
  nft_creator: "bg-tx-nft/10 text-tx-nft border-tx-nft/30",
  cross_currency_payer: "bg-tx-payment/10 text-tx-payment border-tx-payment/30",
  // Whale uses brand salmon — the marquee "this account moves real
  // money" callout. Validator gets the success-token green (network-
  // trust signal). Retone later if the strip ever feels too uniform.
  whale: "bg-brand/10 text-brand border-brand/30",
  validator: "bg-success/10 text-success border-success/30",
};

export default function BehaviorTagChips({ tags }: Props) {
  if (tags.length === 0) return null;
  return (
    <ul
      aria-label="Account behavior tags"
      className="flex flex-wrap items-center gap-1.5"
    >
      {tags.map((tag) => (
        <li key={tag}>
          <span
            className={`inline-flex items-center rounded-tag border px-2 py-0.5 font-display text-tag font-medium uppercase tracking-header ${TAG_COLORS[tag]}`}
          >
            {TAG_LABELS[tag]}
          </span>
        </li>
      ))}
    </ul>
  );
}
