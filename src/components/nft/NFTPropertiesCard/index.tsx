"use client";

import { useCallback } from "react";
import CopyButton from "@/components/shared/CopyButton";
import Button from "@/components/shared/Button";
import CollapsibleCard from "@/components/shared/CollapsibleCard";
import { useNFTMetadata, type NFTMetadata } from "@/hooks/useNFTMetadata";

function decodeHex(hex: string): string | null {
  try {
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
    const pairs = hex.match(/.{1,2}/g);
    if (!pairs) return null;
    const bytes = new Uint8Array(pairs.map((b) => parseInt(b, 16)));
    const decoded = new TextDecoder().decode(bytes);
    return decoded.replace(/\0/g, "").trim() || null;
  } catch {
    return null;
  }
}

/**
 * Off-chain `attributes` (traits) plus the metadata pointer + links
 * — surfaced as a single collapsible card on the NFT detail page.
 *
 * Used to be split: traits lived here, and the metadata URI +
 * Download / xrp.cafe-link footer lived in a separate
 * `NFTMetadataLinks` card. Tim asked to consolidate — same card,
 * "Properties" reads naturally as both per-NFT traits AND the
 * pointer/links to where that metadata lives.
 *
 * Renders null only when there's nothing to show (no URI, no
 * traits). Otherwise the card renders even if just the URI is
 * present, because the user still benefits from the URI display +
 * trade link.
 */
export default function NFTPropertiesCard({
  uri,
  nftId,
  lockOpen,
}: {
  uri: string | null;
  nftId: string;
  lockOpen?: boolean;
}) {
  const { metadata, isLoading } = useNFTMetadata(uri);
  const traits = metadata?.attributes ?? null;
  const hasTraits = !!(traits && traits.length > 0);

  if (!uri && !hasTraits) return null;

  return (
    <CollapsibleCard
      title="Properties"
      storageKey="nft-properties"
      // Only show a count when there are real traits — `0` would
      // read as "0 properties" but we'd still be rendering URI +
      // links inside.
      count={hasTraits ? traits!.length : undefined}
      lockOpen={lockOpen}
    >
      {/* Traits grid — two columns at sm+, single column on mobile.
           Skeleton placeholders while metadata loads so the card
           doesn't pop in. */}
      {isLoading && !hasTraits ? (
        <div
          className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3"
          role="status"
          aria-label="Loading properties"
        >
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-14 animate-pulse motion-reduce:animate-none rounded-lg bg-elevated"
            />
          ))}
        </div>
      ) : hasTraits ? (
        <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3">
          {traits!.map((attr, i) => (
            <div
              key={`${attr.trait_type}-${i}`}
              className="rounded-lg border border-elevated bg-elevated px-3 py-2"
            >
              <p className="font-display text-label uppercase tracking-header text-muted">
                {attr.trait_type}
              </p>
              <p className="mt-0.5 break-all font-mono text-cell font-medium text-primary">
                {attr.value}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {/* Metadata pointer + actions footer. Lives inside Properties
           per the consolidation; visually divided from the traits
           grid above when both are present. Renders null when
           there's no URI to point to. */}
      {uri && (
        <MetadataFooter
          uri={uri}
          metadata={metadata}
          nftId={nftId}
          divided={hasTraits || isLoading}
        />
      )}
    </CollapsibleCard>
  );
}

/**
 * URI display + Download Metadata + Trade-on-xrp.cafe footer.
 * Inlined so Properties stays a single component instead of a
 * three-component card stack — but pulled out of the main JSX so
 * the Card body reads cleanly.
 */
function MetadataFooter({
  uri,
  metadata,
  nftId,
  divided,
}: {
  uri: string;
  metadata: NFTMetadata | null;
  nftId: string;
  /** Render a top divider when there's content above (traits or
   *  skeleton). Skipped when this footer is the only body content. */
  divided: boolean;
}) {
  const decodedUri = decodeHex(uri);

  const handleDownload = useCallback(() => {
    if (!metadata) return;
    const blob = new Blob([JSON.stringify(metadata, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nft-metadata.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [metadata]);

  return (
    <div
      className={`space-y-3 px-4 py-4 ${divided ? "border-t border-elevated" : ""}`}
    >
      {decodedUri && (
        <div>
          <p className="mb-1 font-display text-label font-medium uppercase tracking-header text-muted">
            Metadata URI
          </p>
          <div className="flex min-w-0 items-center gap-1">
            {/^https?:\/\/|^ipfs:\/\//i.test(decodedUri) ? (
              <a
                href={decodedUri}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-mono text-cell text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              >
                {decodedUri}
              </a>
            ) : (
              <span className="truncate font-mono text-cell text-secondary">
                {decodedUri}
              </span>
            )}
            <CopyButton text={decodedUri} />
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {metadata && (
          <Button
            onClick={handleDownload}
            variant="secondary"
            size="sm"
            leftIcon={
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
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            }
          >
            Download Metadata
          </Button>
        )}
        <a
          href={`https://xrp.cafe/nft/${nftId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 rounded-lg bg-elevated px-3 py-1.5 font-mono text-label font-medium text-secondary transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
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
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
          Trade on xrp.cafe
        </a>
      </div>
    </div>
  );
}
