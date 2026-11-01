import NFTGrid from "@/components/account/NFTGrid";
import { useAccountNfts } from "@/hooks/useAccountNfts";

/** Account NFTs tab: the NFTs this account owns right now, live from
 *  rippled via `useAccountNfts`. The count sits in the tab label. */
export default function NFTsTab({ address }: { address: string }) {
  const { nfts, isLoading } = useAccountNfts(address);

  return <NFTGrid nfts={nfts} loadingList={isLoading} />;
}
