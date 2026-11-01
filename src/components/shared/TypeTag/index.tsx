import { getTypeColorKey, type TxColorKey } from "@/lib/xrpl-helpers";
import { cn } from "@/lib/utils";

/* Written out in full so Tailwind's scanner sees every class. */
const TAG_COLORS: Record<TxColorKey, string> = {
  payment: "tag-payment",
  offer: "tag-offer",
  nft: "tag-nft",
  trust: "tag-trust",
  amm: "tag-amm",
  escrow: "tag-escrow",
  account: "tag-account",
  check: "tag-check",
  other: "tag-other",
};

export function TypeTag({ txType, className }: { txType: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-block rounded-tag px-2 py-0.5 font-mono text-tag font-medium whitespace-nowrap",
        TAG_COLORS[getTypeColorKey(txType)],
        className
      )}
    >
      {txType}
    </span>
  );
}

export default TypeTag;
