import { useMemo, useRef } from "react";
import { Link } from "react-router";
import LoadFromHost from "@/components/shared/LoadFromHost";
import { useNftRows, useRequestNfts } from "@/hooks/useNftRows";
import { extractCollectionName } from "@/lib/nft-name-helpers";
import { approveMedia } from "@/lib/media-approvals";
import type { ResolvedNFT } from "@/lib/nft-metadata";
import { truncateHash } from "@/lib/xrpl-helpers";

function NftLink({ id, nft }: { id: string; nft: ResolvedNFT | undefined }) {
  const name = nft?.name ?? null;
  const collection = nft?.collectionName ?? (name ? extractCollectionName(name) : null);
  const askHost = nft?.askHost ?? null;
  // The wrapper renders either way so the link stays mounted: "Load
  // from" moves focus onto it, then disappears.
  const linkRef = useRef<HTMLAnchorElement>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Link
        ref={linkRef}
        to={`/nft/${id}`}
        className="inline-flex items-baseline gap-2 link text-primary"
      >
        <span>{name ?? truncateHash(id, 8)}</span>
        {collection && collection !== name ? (
          <span className="font-mono text-tag text-muted">· {collection}</span>
        ) : null}
      </Link>
      {askHost && (
        <LoadFromHost
          host={askHost}
          what="metadata"
          onLoad={() => approveMedia(id, askHost)}
          focusTarget={linkRef}
        />
      )}
    </span>
  );
}

/**
 * NFTs a tx touches, named from their metadata once it loads (the
 * truncated ID until then, or for good when it can't load). `uri` is the
 * tx's own URI (mint / modify); otherwise `nft_info` finds it.
 */
export default function NftLinks({
  ids: idList,
  total,
  uri,
}: {
  ids: string[];
  total: number;
  uri?: string;
}) {
  const key = idList.join(",");
  const ids = useMemo(() => key.split(","), [key]);
  const items = useMemo(() => ids.map((nftokenId) => ({ nftokenId, uri })), [ids, uri]);
  useRequestNfts(items, { priority: true });
  const rows = useNftRows(ids);

  return (
    <span className="flex flex-wrap gap-x-4 gap-y-1">
      {ids.map((id) => (
        <NftLink key={id} id={id} nft={rows.get(id)} />
      ))}
      {total > ids.length && <span className="text-muted">+{total - ids.length} more</span>}
    </span>
  );
}
