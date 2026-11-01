import { useEffect, useEffectEvent, useMemo, useState, type ImgHTMLAttributes, type Ref } from "react";
import { imageUrls } from "@/lib/nft-media";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "onError" | "onLoad"> & {
  /** An image reference: https URL, `ipfs://`, a gateway URL or `ar://`. */
  src: string;
  ref?: Ref<HTMLImageElement>;
  onLoad?: (img: HTMLImageElement) => void;
  /** Every candidate failed, or the reference isn't safe to load. */
  onFail?: () => void;
};

/**
 * `<img>` loaded straight from IPFS / Arweave gateways (or the source
 * host), moving to the next gateway when one errors. No proxy, no
 * optimizer: NFT art and token icons live on arbitrary hosts.
 */
export default function GatewayImage({ src, ref, onLoad, onFail, alt = "", ...rest }: Props) {
  const urls = useMemo(() => imageUrls(src), [src]);
  const [attempt, setAttempt] = useState({ src, index: 0 });
  const index = attempt.src === src ? attempt.index : 0;
  const url = urls[index];

  const fail = useEffectEvent(() => onFail?.());
  useEffect(() => {
    if (!url) fail();
  }, [url]);

  if (!url) return null;
  return (
    <img
      key={url}
      ref={ref}
      src={url}
      alt={alt}
      decoding="async"
      referrerPolicy="no-referrer"
      onLoad={(e) => onLoad?.(e.currentTarget)}
      onError={() => {
        if (index + 1 < urls.length) setAttempt({ src, index: index + 1 });
        else onFail?.();
      }}
      {...rest}
    />
  );
}
