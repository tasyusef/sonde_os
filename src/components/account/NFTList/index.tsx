import CopyButton from "@/components/shared/CopyButton";

export interface NFToken {
  Flags: number;
  Issuer: string;
  NFTokenID: string;
  NFTokenTaxon: number;
  URI?: string;
  nft_serial: number;
}

export default function NFTList({ nfts }: { nfts: NFToken[] }) {
  if (nfts.length === 0) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-body text-muted">No NFTs found</p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {nfts.map((nft) => {
        let uri: string | null = null;
        if (nft.URI) {
          try {
            uri = Buffer.from(nft.URI, "hex").toString("utf-8") || null;
          } catch {
            uri = null;
          }
        }

        return (
          <div
            key={nft.NFTokenID}
            className="rounded-2xl shadow-card bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-cell text-brand">
                    {nft.NFTokenID.slice(0, 5)}...{nft.NFTokenID.slice(-4)}
                  </span>
                  <CopyButton text={nft.NFTokenID} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1">
                  <Detail label="Taxon" value={nft.NFTokenTaxon.toString()} />
                  <Detail label="Serial" value={nft.nft_serial.toString()} />
                  <Detail label="Flags" value={nft.Flags.toString()} />
                  {uri ? <Detail label="URI" value={uri} /> : null}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <span className="font-mono text-tag">
      <span className="uppercase tracking-header text-muted">{label}: </span>
      <span className="text-secondary">{value}</span>
    </span>
  );
}
