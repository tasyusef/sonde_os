import { useMemo, useState } from "react";
import { Link } from "react-router";
import NFTCard from "@/components/account/NFTCard";
import Button from "@/components/shared/Button";
import GatewayImage from "@/components/shared/GatewayImage";
import { useApprovalsVersion } from "@/hooks/useMediaApproval";
import { useRequestNfts } from "@/hooks/useNftRows";
import { pendingHost } from "@/lib/media-approvals";
import { truncate } from "@/lib/xrpl-helpers";
import { toNftRequest, type NormalizedNFT, type ResolvedRow } from "./types";
import PixelIcon from "@/components/shared/PixelIcon";

const CARDS_PER_PAGE = 6;
/** "Show more" step: keeps requests and cards bounded per click. */
const CARDS_PER_STEP = 24;

/**
 * Accordion row for a single (issuer, taxon) collection. Header
 * always visible; expand to reveal the card grid.
 */
export default function CollectionRow({
  collection,
  name,
  resolved,
}: {
  collection: { key: string; issuer: string; taxon: number; nfts: NormalizedNFT[] };
  name: string | null;
  resolved: Map<string, ResolvedRow>;
}) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(CARDS_PER_PAGE);
  const visible = useMemo(() => collection.nfts.slice(0, shown), [collection.nfts, shown]);
  const nextCount = Math.min(CARDS_PER_STEP, collection.nfts.length - visible.length);
  const canLess = visible.length > CARDS_PER_PAGE;
  useRequestNfts(useMemo(() => visible.map(toNftRequest), [visible]), {
    enabled: open,
    priority: true,
  });

  // The header is a button, so no "Load from" inside it: the thumbnail
  // is the first image that may load without asking.
  const approvals = useApprovalsVersion();
  const thumbUrl = useMemo(() => {
    void approvals;
    for (const nft of collection.nfts) {
      const url = resolved.get(nft.nftId)?.imageUrl;
      if (url && !pendingHost(nft.nftId, url)) return url;
    }
    return null;
  }, [collection.nfts, resolved, approvals]);

  const displayName = name ?? `Collection #${collection.taxon}`;
  const avatarLetter = displayName.trim().charAt(0).toUpperCase() || "·";

  return (
    <div className="flex flex-col border-b border-line last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3 text-left hover:bg-dither"
      >
        <div className="relative size-10 shrink-0 overflow-hidden rounded-lg bg-elevated">
          {thumbUrl ? (
            <GatewayImage
              src={thumbUrl}
              className="absolute inset-0 size-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="absolute inset-0 flex items-center justify-center font-mono text-label font-semibold text-muted">
              {avatarLetter}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <span className="block truncate font-mono text-cell font-bold text-primary">
            {displayName}
          </span>
          <div className="mt-0.5 flex items-center gap-2 font-mono text-tag text-muted">
            <span className="shrink-0">
              {collection.nfts.length} item
              {collection.nfts.length !== 1 ? "s" : ""}
            </span>
            <span aria-hidden="true" className="text-muted/50">
              ·
            </span>
            {/* Anchor inside the expand button; stopPropagation keeps
                 the click from also toggling the row. */}
            <Link
              to={`/account/${collection.issuer}`}
              onClick={(e) => e.stopPropagation()}
              className="truncate link text-primary"
            >
              {truncate(collection.issuer, 5)}
            </Link>
          </div>
        </div>

        <PixelIcon
          name={open ? "chevron-up" : "chevron-down"}
          size="sm"
          className="shrink-0 text-muted"
        />
      </button>

      {open && (
        <div className="flex flex-col gap-3 pt-1 pb-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
            {visible.map((nft) => {
              const meta = resolved.get(nft.nftId);
              return (
                <NFTCard
                  key={nft.nftId}
                  nftId={nft.nftId}
                  serial={nft.serial}
                  name={meta?.name ?? null}
                  imageUrl={meta?.imageUrl ?? null}
                  askHost={meta?.askHost ?? null}
                  loading={!meta}
                />
              );
            })}
          </div>

          {(nextCount > 0 || canLess) && (
            <div className="flex gap-2">
              {nextCount > 0 && (
                <Button
                  onClick={() => setShown(visible.length + nextCount)}
                  variant="secondary"
                  size="sm"
                >
                  Show {nextCount} more
                </Button>
              )}
              {canLess && (
                <Button onClick={() => setShown(CARDS_PER_PAGE)} variant="secondary" size="sm">
                  Show less
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
