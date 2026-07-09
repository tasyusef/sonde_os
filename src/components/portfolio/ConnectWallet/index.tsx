"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { QRCodeSVG } from "qrcode.react";
import Button from "@/components/shared/Button";

// `wc-config` pulls in @walletconnect/universal-provider (~150 KB gz).
// Lazy-loaded inside the click handler so it only ships to users who
// actually click "Connect with Joey", not to every dashboard visitor.

type Status = "idle" | "loading" | "scanning" | "joey-connecting" | "error";

export default function ConnectWallet() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("idle");
  const [wcUri, setWcUri] = useState<string | null>(null);
  const [joeyDeeplink, setJoeyDeeplink] = useState<string | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [deeplink, setDeeplink] = useState<string | null>(null);
  const [uuid, setUuid] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  /* ── Joey flow ── */

  const startJoey = useCallback(async () => {
    setStatus("joey-connecting");
    setError(null);
    setWcUri(null);
    setJoeyDeeplink(null);

    try {
      const { connectJoeyWallet } = await import("@/lib/wc-config");
      await connectJoeyWallet((uri, dl) => {
        setWcUri(uri);
        setJoeyDeeplink(dl);
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Joey connection failed");
      setStatus("error");
    }
  }, [router]);

  /* ── Xaman flow ── */

  const startXaman = useCallback(async () => {
    setStatus("loading");
    setError(null);

    try {
      const res = await fetch("/api/auth/xaman", { method: "POST" });
      if (!res.ok) throw new Error("Failed to create sign-in request");

      const data = await res.json();
      setQrUrl(data.qrUrl);
      setDeeplink(data.deeplink);
      setUuid(data.uuid);
      setStatus("scanning");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setStatus("error");
    }
  }, []);

  // Poll for Xaman payload resolution
  useEffect(() => {
    if (status !== "scanning" || !uuid) return;

    let cancelled = false;
    const MAX_POLL_ATTEMPTS = 150;
    const poll = async () => {
      let attempts = 0;
      while (!cancelled && attempts < MAX_POLL_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2000));
        if (cancelled) break;
        attempts++;

        try {
          const res = await fetch(`/api/auth/xaman/status?uuid=${uuid}`);
          if (res.status >= 400 && res.status < 500) {
            setError("Sign-in request failed");
            setStatus("error");
            return;
          }
          const data = await res.json();

          if (data.status === "resolved") {
            router.refresh();
            return;
          }
          if (data.status === "rejected") {
            setError("Sign-in was rejected");
            setStatus("error");
            return;
          }
        } catch {
          // Network error — keep polling
        }
      }
      if (!cancelled && attempts >= MAX_POLL_ATTEMPTS) {
        setError("Sign-in request timed out. Please try again.");
        setStatus("error");
      }
    };

    poll();
    return () => { cancelled = true; };
  }, [status, uuid, router]);

  const reset = () => {
    setStatus("idle");
    setWcUri(null);
    setJoeyDeeplink(null);
    setQrUrl(null);
    setUuid(null);
    setError(null);
  };

  const showButtons = status === "idle" || status === "error";

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex w-full max-w-md flex-col items-center gap-8 rounded-2xl shadow-card bg-surface p-8">
        {/* Icon */}
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-brand"
          >
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <path d="M22 10H2" />
            <path d="M6 14h4" />
          </svg>
        </div>

        <div className="flex flex-col items-center gap-2 text-center">
          <h2 className="font-display text-heading font-semibold text-primary">
            Connect Wallet
          </h2>
          <p className="max-w-xs font-body text-body text-muted">
            Sign in with your XRPL wallet to track your portfolio and view
            historical performance.
          </p>
        </div>

        {/* Joey QR Code */}
        {status === "joey-connecting" && wcUri && (
          <div className="flex flex-col items-center gap-4">
            <div className="overflow-hidden rounded-xl bg-white p-3">
              <QRCodeSVG value={wcUri} size={200} />
            </div>
            <p className="font-mono text-label text-muted">
              Scan with Joey Wallet to sign in
            </p>
            {joeyDeeplink && (
              <a
                href={joeyDeeplink}
                className="font-mono text-label font-medium text-brand underline underline-offset-2 hover:text-brand-light"
              >
                Open in Joey Wallet
              </a>
            )}
          </div>
        )}

        {/* Joey connecting spinner (before QR appears) */}
        {status === "joey-connecting" && !wcUri && (
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <span className="font-mono text-label text-muted">
              Initializing...
            </span>
          </div>
        )}

        {/* Xaman QR Code */}
        {status === "scanning" && qrUrl && (
          <div className="flex flex-col items-center gap-4">
            <div className="overflow-hidden rounded-xl bg-white p-3">
              <Image
                src={qrUrl}
                alt="Scan with Xaman"
                width={200}
                height={200}
                unoptimized
              />
            </div>
            <p className="font-mono text-label text-muted">
              Scan with Xaman to sign in
            </p>
            {deeplink && (
              <a
                href={deeplink}
                className="font-mono text-label font-medium text-brand underline underline-offset-2 hover:text-brand-light"
              >
                Open in Xaman app
              </a>
            )}
          </div>
        )}

        {/* Error */}
        {status === "error" && error && (
          <p role="alert" className="font-mono text-label text-error">
            {error}
          </p>
        )}

        {/* Buttons */}
        {showButtons && (
          <div className="flex w-full flex-col gap-3">
            <Button
              onClick={startJoey}
              variant="primary"
              size="lg"
              fullWidth
              className="hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
            >
              Connect with Joey
            </Button>
            <Button
              onClick={startXaman}
              variant="secondary"
              size="lg"
              fullWidth
              className="hover:scale-[1.02] hover:shadow-lg active:scale-[0.98]"
            >
              Connect with Xaman
            </Button>
          </div>
        )}

        {/* Loading (Xaman) */}
        {status === "loading" && (
          <div className="flex items-center gap-3">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <span className="font-mono text-label text-muted">
              Creating sign-in request...
            </span>
          </div>
        )}

        {/* Cancel */}
        {(status === "scanning" || status === "joey-connecting") && (
          <button
            onClick={reset}
            className="font-mono text-label text-muted underline underline-offset-2 hover:text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
