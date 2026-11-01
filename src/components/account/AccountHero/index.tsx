import CopyButton from "@/components/shared/CopyButton";
import Decode from "@/components/shared/Decode";
import WatchButton from "@/components/account/WatchButton";
import type { AccountType } from "@/lib/known-addresses";

const TYPE_TEXT: Record<AccountType["category"], string> = {
  amm: "text-tx-amm-fg",
  issuer: "text-tx-trust-fg",
  "nft-issuer": "text-tx-nft-fg",
  regular: "text-muted",
};

/**
 * The top of the account page's stage: what it is (a known name, else
 * the address itself), the address, and the one way to act on it.
 * Renders straight from the URL; the type lands with `account_info`.
 */
export default function AccountHero({
  address,
  knownName,
  destinationTag,
  accountType,
  watchable,
}: {
  address: string;
  knownName: string | null;
  destinationTag: number | null;
  accountType: AccountType | null;
  /** False for an address that isn't one, so there's nothing to watch. */
  watchable: boolean;
}) {
  const type = accountType?.category === "regular" ? null : accountType;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 font-display text-caps uppercase">
        <span className="text-muted">Account</span>
        {type && <span className={TYPE_TEXT[type.category]}>{type.label}</span>}
      </div>

      {knownName ? (
        <>
          {/* A known name is third-party data, so it keeps its case and the data face. */}
          <h1 className="mt-3 break-words font-mono text-value text-primary">{knownName}</h1>
          <div className="mt-2 flex items-center gap-2">
            <span className="sr-only">Address: </span>
            <span className="min-w-0 break-all font-mono text-cell text-primary">
              <Decode text={address} />
            </span>
            <CopyButton text={address} />
          </div>
        </>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <h1 className="min-w-0 break-all font-mono text-value text-primary">
            <span className="sr-only">Account </span>
            <Decode text={address} />
          </h1>
          <CopyButton text={address} size="md" />
        </div>
      )}

      {destinationTag != null && (
        <p className="mt-2 font-mono text-cell text-muted">
          Destination tag <span className="tabular-nums text-primary">{destinationTag}</span>
        </p>
      )}

      {watchable && <WatchButton address={address} className="mt-6" />}
    </div>
  );
}

export { AccountHero };
