import type { NFTInfo } from "@/types/nft";
import AddressLink from "@/components/shared/AddressLink";
import CollapsibleCard from "@/components/shared/CollapsibleCard";

/**
 * On-chain identity for the NFT detail page — owner / issuer /
 * taxon / serial / transfer fee / flags. Renders synchronously
 * from the `nft_info` shell already fetched by `page.tsx`, so no
 * loading state.
 *
 * Layout: a vertical key/value table inside a collapsible card.
 * Pre-redesign this was a 6-cell `grid grid-cols-2 divide-x` with
 * hard vertical borders that read as "blocky" on mobile — replaced
 * with a clean row-per-stat pattern, label on the left, value on
 * the right, divider rules between rows. Mobile-first by default
 * (single column at every viewport — long values wrap inside their
 * cell rather than getting truncated or overflowing).
 */
export default function NFTDetailsBar({
  nft,
  lockOpen,
}: {
  nft: NFTInfo;
  lockOpen?: boolean;
}) {
  const transferFee = ((nft.transfer_fee ?? 0) / 1000).toFixed(2);
  const isBurnable = (nft.flags & 0x0001) !== 0;
  const isOnlyXRP = (nft.flags & 0x0002) !== 0;
  const isTransferable = (nft.flags & 0x0008) !== 0;

  return (
    <CollapsibleCard
      title="Details"
      storageKey="nft-details"
      lockOpen={lockOpen}
    >
      <dl className="divide-y divide-elevated">
        <Row label="Owner">
          {nft.owner ? (
            <AddressLink address={nft.owner} />
          ) : (
            <span className="font-mono text-cell text-muted">Unknown</span>
          )}
        </Row>
        <Row label="Issuer">
          <AddressLink address={nft.issuer} />
        </Row>
        <Row label="Taxon">
          <span className="font-mono text-cell tabular-nums text-primary">
            {nft.nft_taxon}
          </span>
        </Row>
        <Row label="Serial">
          <span className="font-mono text-cell tabular-nums text-primary">
            {nft.nft_serial}
          </span>
        </Row>
        <Row label="Transfer Fee">
          <span className="font-mono text-cell tabular-nums text-primary">
            {transferFee}%
          </span>
        </Row>
        <Row label="Flags">
          <div className="flex flex-wrap gap-1">
            {isTransferable && <Flag label="Transferable" />}
            {isBurnable && <Flag label="Burnable" />}
            {isOnlyXRP && <Flag label="Only XRP" />}
            {!isTransferable && !isBurnable && !isOnlyXRP && (
              <span className="font-mono text-cell text-muted">None</span>
            )}
          </div>
        </Row>
      </dl>
    </CollapsibleCard>
  );
}

/**
 * One row of the key/value table. `dt` left, `dd` right; both
 * mono. Right side wraps freely so long addresses or many flag
 * pills don't break the layout.
 */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3">
      <dt className="shrink-0 font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
      </dt>
      <dd className="min-w-0 break-words text-right">{children}</dd>
    </div>
  );
}

function Flag({ label }: { label: string }) {
  return (
    <span className="rounded-tag bg-elevated px-1.5 py-0.5 font-mono text-label font-medium text-secondary">
      {label}
    </span>
  );
}

export { NFTDetailsBar };
