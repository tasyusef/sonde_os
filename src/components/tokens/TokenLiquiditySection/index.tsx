"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { TokenAMMPool } from "@/types/token";
import { formatCompactNumber } from "@/lib/xrpl-helpers";
import AddressLink from "@/components/shared/AddressLink";

function formatFee(fee: number): string {
  const pct = fee / 1000;
  return `${pct.toFixed(3).replace(/\.?0+$/, "")}%`;
}

/** Rough TVL proxy — paired side × 2 assumes balanced pool value. Good
 *  enough for sorting within a single token page. */
function poolTvl(pool: TokenAMMPool): number {
  return pool.pairedAmount * 2;
}

function PoolCard({
  pool,
  currencyDisplay,
}: {
  pool: TokenAMMPool;
  currencyDisplay: string;
}) {
  const pairedSuffix = pool.pairedIsXrp ? " XRP" : "";
  const totalValue =
    pool.pairedAmount + pool.targetAmount * (pool.pairedAmount / Math.max(pool.targetAmount, 1));
  const pairedPercent = totalValue > 0 ? (pool.pairedAmount / totalValue) * 100 : 50;
  const tokenPercent = 100 - pairedPercent;

  return (
    <div className="space-y-5 p-4">
      {/* Pool pair header */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-cell font-medium text-primary">
          {pool.pairedLabel} / {currencyDisplay}
        </span>
        <AddressLink address={pool.ammAccount} />
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={`${pool.pairedLabel} Liquidity`}>
          {formatCompactNumber(pool.pairedAmount)}
          {pairedSuffix}
        </StatTile>
        <StatTile label={`${currencyDisplay} Liquidity`}>
          {formatCompactNumber(pool.targetAmount)}
        </StatTile>
        <StatTile label="Trading Fee">{formatFee(pool.tradingFee)}</StatTile>
        <StatTile label="LP Holders">{pool.lpHolders.toLocaleString()}</StatTile>
      </div>

      {/* Liquidity composition bar */}
      <div className="space-y-2">
        <p className="font-display text-label uppercase tracking-header text-muted">Pool Composition</p>
        <div className="flex h-8 w-full overflow-hidden rounded-lg">
          <div
            className="flex items-center justify-center bg-brand/80 transition-all"
            style={{ width: `${Math.max(pairedPercent, 5)}%` }}
          >
            {pairedPercent >= 15 && (
              <span className="font-mono text-label font-medium text-white">
                {pairedPercent.toFixed(1)}%
              </span>
            )}
          </div>
          <div
            className="flex items-center justify-center bg-success/80 transition-all"
            style={{ width: `${Math.max(tokenPercent, 5)}%` }}
          >
            {tokenPercent >= 15 && (
              <span className="font-mono text-label font-medium text-white">
                {tokenPercent.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        <div className="flex justify-between font-mono text-label text-muted">
          <span>
            {pool.pairedLabel} — {formatCompactNumber(pool.pairedAmount)}
            {pairedSuffix}
          </span>
          <span>
            {currencyDisplay} — {formatCompactNumber(pool.targetAmount)}
          </span>
        </div>
      </div>
    </div>
  );
}

function StatTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-elevated bg-surface px-3 py-2.5">
      <p className="font-display text-label uppercase tracking-header text-muted">{label}</p>
      <p className="mt-1 font-mono text-cell font-medium text-primary tabular-nums">{children}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal: all pools in a compact, sortable-by-position table          */
/* ------------------------------------------------------------------ */

function AllPoolsModal({
  pools,
  currencyDisplay,
  onClose,
}: {
  pools: TokenAMMPool[];
  currencyDisplay: string;
  onClose: () => void;
}) {
  // Close on Escape; lock page scroll while open so the backdrop is the
  // only scroll surface.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose]);

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label={`All AMM pools for ${currencyDisplay}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-surface shadow-card"
      >
        <header className="flex items-center justify-between border-b border-elevated px-5 py-3">
          <div>
            <h3 className="font-display text-label font-bold uppercase tracking-header text-brand">
              All AMM Pools ({pools.length})
            </h3>
            <p className="mt-0.5 font-mono text-tag text-muted">
              Sorted by TVL descending
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-elevated hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-surface">
              <tr className="border-b border-elevated">
                <Th>Pair</Th>
                <Th className="text-right">{currencyDisplay} Liquidity</Th>
                <Th className="text-right">Paired Liquidity</Th>
                <Th className="text-right">Fee</Th>
                <Th className="text-right">LP Holders</Th>
                <Th className="text-right">AMM Account</Th>
              </tr>
            </thead>
            <tbody>
              {pools.map((pool) => (
                <tr
                  key={pool.ammAccount}
                  className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
                >
                  <td className="px-4 py-2.5 font-mono text-cell font-medium text-primary">
                    {pool.pairedLabel} / {currencyDisplay}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-cell tabular-nums text-primary">
                    {formatCompactNumber(pool.targetAmount)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-cell tabular-nums text-primary">
                    {formatCompactNumber(pool.pairedAmount)}
                    {pool.pairedIsXrp ? " XRP" : ""}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-cell tabular-nums text-secondary">
                    {formatFee(pool.tradingFee)}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-cell tabular-nums text-secondary">
                    {pool.lpHolders.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <AddressLink address={pool.ammAccount} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={`px-4 py-2.5 font-display text-label font-medium uppercase tracking-header text-muted ${className ?? ""}`}
    >
      {children}
    </th>
  );
}

/* ------------------------------------------------------------------ */

export default function TokenLiquiditySection({
  pools,
  currencyDisplay,
}: {
  pools: TokenAMMPool[];
  currencyDisplay: string;
}) {
  const [open, setOpen] = useState(false);

  if (pools.length === 0) return null;

  // Sort largest first by TVL.
  const sorted = [...pools].sort((a, b) => poolTvl(b) - poolTvl(a));
  const topPool = sorted[0];
  const extraCount = sorted.length - 1;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between px-1">
        <span className="font-display text-label font-bold uppercase tracking-header text-brand">
          AMM Liquidity
        </span>
        {extraCount > 0 && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="font-mono text-label text-muted transition-colors hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-lg px-2 py-1"
          >
            View all {sorted.length} pools →
          </button>
        )}
      </div>

      <div className="rounded-2xl bg-surface shadow-card">
        <PoolCard pool={topPool} currencyDisplay={currencyDisplay} />
      </div>

      <AnimatePresence>
        {open && (
          <AllPoolsModal
            pools={sorted}
            currencyDisplay={currencyDisplay}
            onClose={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export { TokenLiquiditySection };
