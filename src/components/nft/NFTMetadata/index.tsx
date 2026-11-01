import { useCallback } from "react";
import Button from "@/components/shared/Button";
import CopyButton from "@/components/shared/CopyButton";
import PixelIcon from "@/components/shared/PixelIcon";
import Section from "@/components/shared/Section";
import { useNFTMetadata } from "@/hooks/useNFTMetadata";
import { hexToUtf8 } from "@/lib/hex";

/** Where the NFT's metadata lives (its URI field), and the metadata
 *  itself as a download once it has loaded. */
export default function NFTMetadata({ uri, nftId }: { uri: string | null; nftId: string }) {
  const { metadata } = useNFTMetadata(uri, nftId);
  const decoded = uri ? hexToUtf8(uri).replace(/\0/g, "").trim() : "";

  const download = useCallback(() => {
    if (!metadata) return;
    const blob = new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nft-metadata.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [metadata]);

  if (!decoded) return null;

  return (
    <Section title="Metadata">
      <div className="flex items-start gap-1">
        {/^https?:\/\/|^ipfs:\/\//i.test(decoded) ? (
          <a
            href={decoded}
            target="_blank"
            rel="noopener noreferrer"
            className="link min-w-0 break-all font-mono text-cell text-primary"
          >
            {decoded}
          </a>
        ) : (
          <span className="min-w-0 break-all font-mono text-cell text-primary">{decoded}</span>
        )}
        <CopyButton text={decoded} />
      </div>
      {metadata && (
        <Button
          onClick={download}
          variant="secondary"
          size="sm"
          className="mt-4"
          leftIcon={<PixelIcon name="download" size="sm" />}
        >
          Download JSON
        </Button>
      )}
    </Section>
  );
}

export { NFTMetadata };
