"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/** Route IPFS-hosted icons through our /api/nft-image proxy so the
 *  server can fall back across working gateways when the source
 *  gateway is broken (e.g. ipfs.firstledger.net's flaky SSL).
 *  Direct CDN URLs (Twitter profile pics, sologenic.org, etc.) load
 *  fine on their own — pass them through unchanged to avoid extra
 *  proxy hops. */
function resolveIconSrc(url: string): string {
  if (!url || url.startsWith("/")) return url;
  if (/\/ipfs\/(Qm|bafy|baf[a-z2-7]+)/i.test(url)) {
    return `/api/nft-image?url=${encodeURIComponent(url)}`;
  }
  return url;
}

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
  // content, network failures the proxy can't recover from) gracefully
  // degrade to the letter circle. Timeout is a backup for SSL handshake
  // failures where `onError` never fires — the proxy catches most of
  // those upstream now, but the client guard stays as defense in
  // depth.
  //
  // Bumped 4s → 12s on 2026-05-10. Token icons routed through the IPFS
  // gateway chain regularly take 5–8s on cold cache (caught with the
  // Top Tokens card showing letter fallbacks for ARMY / PHNIX despite
  // both having icons in the DB and the proxy returning HTTP 200 at
  // ~5.4s). 12s lets cold IPFS loads through while still bounding
  // truly hung requests.
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
      <Image
        ref={imgRef}
        key={src}
        src={resolveIconSrc(src)}
        alt={currency}
        width={size}
        height={size}
        className={cn("rounded-full", className)}
        // Token issuers ship inconsistent assets. The optimizer would
        // surface those as page-breaking errors; unoptimized falls
        // back to the source URL with our existing CSP guard.
        unoptimized
        onError={() => setErrored(true)}
      />
    );
  }

  return (
    <div
      style={{ width: size, height: size, minWidth: size }}
      className={cn(
        "flex items-center justify-center rounded-full bg-elevated font-mono text-label font-medium text-secondary",
        className
      )}
    >
      {currency.charAt(0)}
    </div>
  );
}
