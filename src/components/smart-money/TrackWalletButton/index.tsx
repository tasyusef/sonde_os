"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/useAuth";
import Button, { buttonClasses } from "@/components/shared/Button";

interface TrackWalletButtonProps {
  address: string;
}

export default function TrackWalletButton({ address }: TrackWalletButtonProps) {
  const { address: userAddress } = useAuth();
  const [state, setState] = useState<"idle" | "creating" | "success" | "error">("idle");

  const handleTrack = useCallback(async () => {
    setState("creating");
    try {
      const res = await fetch("/api/intel/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "smart_money_trade",
          conditions: { addresses: [address], direction: "any" },
        }),
      });
      if (res.ok) {
        setState("success");
      } else {
        setState("error");
      }
    } catch {
      setState("error");
    }
  }, [address]);

  // Not logged in
  if (!userAddress) {
    return (
      <Link
        href="/portfolio"
        className={buttonClasses({ variant: "secondary", size: "md" })}
      >
        <BellIcon />
        Connect wallet to track
      </Link>
    );
  }

  // Success
  if (state === "success") {
    return (
      <span className="inline-flex items-center gap-2 rounded-lg bg-success/10 px-4 py-2 font-mono text-cell font-medium text-success">
        <CheckIcon />
        Tracking this wallet
      </span>
    );
  }

  return (
    <Button
      onClick={handleTrack}
      loading={state === "creating"}
      variant="primary"
      size="md"
      leftIcon={<BellIcon />}
    >
      {state === "creating" ? "Creating alert..." : state === "error" ? "Retry" : "Track this wallet"}
    </Button>
  );
}

function BellIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
