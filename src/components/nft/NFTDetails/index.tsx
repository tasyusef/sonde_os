import type { NFTInfo } from "@/types/nft";
import AddressLink from "@/components/shared/AddressLink";
import Facts, { Fact } from "@/components/shared/Facts";
import Section from "@/components/shared/Section";

/** On-chain facts from `nft_info`, so there's no loading state. */
export default function NFTDetails({ nft }: { nft: NFTInfo }) {
  const transferFee = ((nft.transfer_fee ?? 0) / 1000).toFixed(2);
  const flags = [
    (nft.flags & 0x0008) !== 0 && "Transferable",
    (nft.flags & 0x0001) !== 0 && "Burnable",
    (nft.flags & 0x0002) !== 0 && "Only XRP",
  ].filter(Boolean);

  return (
    <Section title="Details">
      <Facts>
        <Fact label="Owner">
          {nft.owner ? <AddressLink address={nft.owner} /> : <span className="text-muted">Unknown</span>}
        </Fact>
        <Fact label="Issuer">
          <AddressLink address={nft.issuer} />
        </Fact>
        <Fact label="Taxon">
          <span className="tabular-nums">{nft.nft_taxon}</span>
        </Fact>
        <Fact label="Serial">
          <span className="tabular-nums">{nft.nft_serial}</span>
        </Fact>
        <Fact label="Transfer Fee">
          <span className="tabular-nums">{transferFee}%</span>
        </Fact>
        <Fact label="Flags">
          {flags.length > 0 ? flags.join(" · ") : <span className="text-muted">None</span>}
        </Fact>
      </Facts>
    </Section>
  );
}

export { NFTDetails };
