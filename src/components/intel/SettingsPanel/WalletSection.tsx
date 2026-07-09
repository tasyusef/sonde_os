"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { useAuth } from "@/hooks/useAuth";
import { useSubscription } from "@/hooks/useSubscription";
import { motion, AnimatePresence } from "motion/react";
import { cn, copyToClipboard } from "@/lib/utils";
import Button from "@/components/shared/Button";
import AiUsageBar from "./AiUsageBar";

// `wc-config` pulls in @walletconnect/universal-provider (~150 KB gz).
// Lazy-loaded inside the click handler so it only ships to users who
// actually click "Connect with Joey", not to every Settings visitor.

type WalletStatus = "idle" | "loading" | "scanning" | "joey-connecting" | "error";

const TIER_LABELS: Record<string, string> = {
  free: "Free",
  pro: "Pro",
};

/* ── Connected wallet with plan management ── */

function ConnectedWallet({
  address,
  tier,
  logout,
  router,
  onDone,
}: {
  address: string;
  tier: string;
  logout: () => Promise<void>;
  router: ReturnType<typeof useRouter>;
  onDone: () => void;
}) {
  const { status: subStatus, cancelAtPeriodEnd, periodEnd, paymentMethod, mutate } = useSubscription();
  const [showManage, setShowManage] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const isFree = tier === "free";
  const isPaid = !isFree && (subStatus === "active" || subStatus === "past_due");

  async function handleCancel() {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch("/api/subscription/cancel", { method: "POST" });
      if (!res.ok) { setActionError("Failed to cancel"); return; }
      mutate();
      setConfirmCancel(false);
      setShowManage(false);
    } catch {
      setActionError("Network error");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleReactivate() {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch("/api/subscription/reactivate", { method: "POST" });
      if (!res.ok) { setActionError("Failed to reactivate"); return; }
      mutate();
      setShowManage(false);
    } catch {
      setActionError("Network error");
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePortal() {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch("/api/subscription/portal", { method: "POST" });
      if (!res.ok) { setActionError("Billing portal unavailable"); return; }
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch {
      setActionError("Network error");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <div>
      <span className="font-display text-label font-semibold uppercase tracking-header text-muted">Wallet</span>
      <div className="mt-1.5 space-y-2">
        {/* Address */}
        <div className="flex items-center gap-2 rounded-lg border border-elevated bg-surface px-3 py-2">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
          <span className="flex-1 truncate font-mono text-cell text-brand">
            {address.slice(0, 8)}...{address.slice(-4)}
          </span>
          <button
            onClick={() => { copyToClipboard(address); }}
            className="shrink-0 font-mono text-label text-muted hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            aria-label="Copy address"
          >
            Copy
          </button>
        </div>

        {/* Plan — clickable */}
        <button
          onClick={() => {
            if (isFree) { router.push("/pricing"); onDone(); }
            else { setShowManage(!showManage); setConfirmCancel(false); }
          }}
          className="flex w-full items-center justify-between rounded-lg border border-elevated bg-surface px-3 py-2 transition-colors hover:border-brand/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        >
          <span className="font-mono text-label text-muted">Plan</span>
          <span className="flex items-center gap-1.5">
            <span className={cn(
              "rounded-tag px-2 py-0.5 font-mono text-tag font-semibold",
              isFree ? "bg-elevated text-muted" : "bg-brand/10 text-brand",
            )}>
              {TIER_LABELS[tier] ?? tier}
            </span>
            <svg
              className={cn(
                "h-3 w-3 text-muted transition-transform duration-200",
                isFree ? "rotate-0" : showManage ? "rotate-180" : "rotate-0",
              )}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              {isFree ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
              )}
            </svg>
          </span>
        </button>

        {/* AI usage bar (Pro only) */}
        {tier === "pro" && <AiUsageBar />}

        {/* Manage panel (paid users) */}
        <AnimatePresence initial={false}>
          {showManage && isPaid && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="overflow-hidden"
            >
              <div className="space-y-1.5 rounded-lg border border-elevated bg-surface p-2">
                {cancelAtPeriodEnd ? (
                  <>
                    <p className="px-1 font-mono text-label text-muted">
                      Canceled — access until{" "}
                      {periodEnd?.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </p>
                    <Button onClick={handleReactivate} loading={actionLoading} variant="primary" size="sm" fullWidth>
                      Reactivate
                    </Button>
                  </>
                ) : confirmCancel ? (
                  <>
                    <p className="px-1 font-mono text-label text-muted">
                      Cancel subscription? You&apos;ll keep access until the end of your billing period.
                    </p>
                    <div className="flex gap-1.5">
                      <Button onClick={handleCancel} loading={actionLoading} variant="danger" size="sm" className="flex-1">Confirm</Button>
                      <Button onClick={() => setConfirmCancel(false)} variant="outline" size="sm" className="flex-1">Keep Plan</Button>
                    </div>
                  </>
                ) : (
                  <>
                    {paymentMethod === "stripe" && (
                      <Button onClick={handlePortal} loading={actionLoading} variant="outline" size="sm" fullWidth>
                        Manage Billing
                      </Button>
                    )}
                    <Button onClick={() => setConfirmCancel(true)} variant="ghost" size="sm" fullWidth className="hover:text-error">
                      Cancel Subscription
                    </Button>
                  </>
                )}
                {subStatus === "past_due" && paymentMethod === "stripe" && (
                  <Button onClick={handlePortal} loading={actionLoading} variant="danger" size="sm" fullWidth>
                    Update Payment Method
                  </Button>
                )}
                {actionError && (
                  <p role="alert" className="px-1 font-mono text-label text-error">{actionError}</p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Sign out — wrapped in try/catch so a failing /api/auth/logout
             surfaces as a visible error rather than a silent unhandled
             rejection (React doesn't catch async-onClick rejections). */}
        <Button
          onClick={async () => {
            try {
              await logout();
              router.refresh();
              onDone();
            } catch (err) {
              console.error("[WalletSection] Sign out failed:", err);
              alert("Couldn't sign you out. Try again or refresh the page.");
            }
          }}
          variant="outline"
          size="sm"
          fullWidth
          className="hover:border-error hover:text-error"
        >
          Sign Out
        </Button>
      </div>
    </div>
  );
}

/* ── Wallet section ── */

export default function WalletSection({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { address, logout } = useAuth();
  const { tier } = useSubscription();
  const [status, setStatus] = useState<WalletStatus>("idle");
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
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Joey connection failed");
      setStatus("error");
    }
  }, [router, onDone]);

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

  const reset = () => {
    setStatus("idle");
    setWcUri(null);
    setJoeyDeeplink(null);
    setQrUrl(null);
    setDeeplink(null);
    setUuid(null);
    setError(null);
  };

  // Poll Xaman with AbortController
  useEffect(() => {
    if (status !== "scanning" || !uuid) return;
    let cancelled = false;
    const controller = new AbortController();
    const poll = async () => {
      while (!cancelled) {
        await new Promise((r) => setTimeout(r, 2000));
        if (cancelled) break;
        try {
          const res = await fetch(`/api/auth/xaman/status?uuid=${encodeURIComponent(uuid)}`, { signal: controller.signal });
          const data = await res.json();
          if (cancelled) break;
          if (data.status === "resolved") { router.refresh(); onDone(); return; }
          if (data.status === "rejected") { setError("Sign-in was rejected"); setStatus("error"); return; }
        } catch {
          if (cancelled) break;
        }
      }
    };
    poll();
    return () => { cancelled = true; controller.abort(); };
  }, [status, uuid, router, onDone]);

  // Connected state
  if (address) {
    return <ConnectedWallet address={address} tier={tier} logout={logout} router={router} onDone={onDone} />;
  }

  // Disconnected state
  const showButtons = status === "idle" || status === "error";

  return (
    <div>
      <span className="font-display text-label font-semibold uppercase tracking-header text-muted">Wallet</span>
      <div className="mt-1.5 space-y-1.5">
        {/* Error */}
        {status === "error" && error && (
          <p role="alert" className="rounded-lg bg-error/10 px-3 py-2 font-mono text-label text-error">
            {error}
          </p>
        )}

        {/* Joey QR Code */}
        {status === "joey-connecting" && wcUri && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-elevated bg-surface p-3">
            <div className="overflow-hidden rounded-lg bg-white p-2">
              <QRCodeSVG value={wcUri} size={140} />
            </div>
            <span className="font-mono text-label text-muted">Scan with Joey Wallet</span>
            {joeyDeeplink && (
              <a
                href={joeyDeeplink}
                className="font-mono text-label font-medium text-brand underline underline-offset-2 hover:text-brand-light transition-colors"
              >
                Open in Joey Wallet
              </a>
            )}
          </div>
        )}

        {/* Joey connecting spinner */}
        {status === "joey-connecting" && !wcUri && (
          <div role="status" aria-label="Connecting to Joey wallet" className="flex items-center justify-center gap-2.5 rounded-lg bg-brand/10 px-3 py-2.5">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <span className="font-mono text-label text-muted">Initializing...</span>
          </div>
        )}

        {/* Xaman QR Code */}
        {status === "scanning" && qrUrl && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-elevated bg-surface p-3">
            <div className="overflow-hidden rounded-lg bg-white p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="Scan with Xaman" width={140} height={140} />
            </div>
            <span className="font-mono text-label text-muted">Scan with Xaman to sign in</span>
            {deeplink && (
              <a
                href={deeplink}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-label font-medium text-brand underline underline-offset-2 hover:text-brand-light transition-colors"
              >
                Open in Xaman app
              </a>
            )}
          </div>
        )}

        {/* Loading (Xaman creating request) */}
        {status === "loading" && (
          <div role="status" aria-label="Creating sign-in request" className="flex items-center justify-center gap-2.5 rounded-lg bg-brand/10 px-3 py-2.5">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand border-t-transparent" />
            <span className="font-mono text-label text-muted">Creating sign-in request...</span>
          </div>
        )}

        {/* Buttons */}
        {showButtons && (
          <>
            <Button onClick={startJoey} variant="primary" size="md" fullWidth>
              Connect with Joey
            </Button>
            <Button onClick={startXaman} variant="secondary" size="md" fullWidth>
              Connect with Xaman
            </Button>
          </>
        )}

        {/* Cancel */}
        {(status === "scanning" || status === "joey-connecting") && (
          <button
            onClick={reset}
            className="w-full rounded-lg px-2 py-1 font-mono text-label text-muted underline underline-offset-2 hover:text-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
