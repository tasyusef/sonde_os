import { useState, useEffect, useRef } from "react";
import GatewayImage from "@/components/shared/GatewayImage";
import { cn } from "@/lib/utils";

export default function TokenIcon({
  src,
  currency,
  size = 24,
  className,
}: {
  src: string | null;
  currency: string;
  size?: number;
  className?: string;
}) {
  // Per-instance load tracking so broken token icons (404s, non-image
  // content, every gateway failing) degrade to the letter circle. The
  // 12 s timeout is a backup for SSL handshake failures where `onError`
  // never fires; cold IPFS loads regularly take 5–8 s.
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (!src) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- need to reset errored when src changes so a new URL gets a fresh attempt
    setErrored(false);
    const t = window.setTimeout(() => {
      const img = imgRef.current;
      if (img && !img.complete) setErrored(true);
    }, 12000);
    return () => window.clearTimeout(t);
  }, [src]);

  if (src && !errored) {
    return (
      // IPFS-hosted icons fall back across gateways when the source
      // gateway is broken (e.g. ipfs.firstledger.net's flaky SSL).
      <GatewayImage
        ref={imgRef}
        key={src}
        src={src}
        alt={currency}
        width={size}
        height={size}
        className={cn("rounded-full", className)}
        onFail={() => setErrored(true)}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size, minWidth: size }}
      className={cn(
        "flex items-center justify-center rounded-full bg-elevated font-mono text-label font-medium text-primary",
        className
      )}
    >
      {currency.charAt(0)}
    </div>
  );
}
