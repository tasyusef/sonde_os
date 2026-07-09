"use client";

import { useState } from "react";
import useSWR from "swr";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { formatVolume } from "@/lib/format";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import Toggle from "@/components/shared/Toggle";

interface CurrentPortfolio {
  xrpBalance: number;
  xrpPriceUsd: number;
  tokenValueUsd: number;
  ammValueUsd: number;
  lockedXrp: number;
  totalValueUsd: number;
  tokenBreakdown: {
    currency: string;
    issuer: string;
    name: string;
    balance: number;
    usd: number;
  }[];
}

interface Item {
  name: string;
  currentUsd: number;
  balance: number;
  pricePerUnit: number;
}

type InputMode = "pct" | "price";


export default function WhatIfSimulator({
  expanded: initialExpanded = false,
}: {
  expanded?: boolean;
} = {}) {
  const { data } = useSWR<CurrentPortfolio>(
    CACHE_KEYS.portfolioCurrent(),
    fetcher,
  );

  const [mode, setMode] = useState<InputMode>("pct");
  // pct mode: stores % change per token
  // price mode: stores target price (USD per unit) per token
  const [inputs, setInputs] = useState<Map<string, string>>(new Map());
  const [expanded, setExpanded] = useState(initialExpanded);

  if (!data) return null;

  const xrpValue = data.xrpBalance * data.xrpPriceUsd;

  const items: Item[] = [
    {
      name: "XRP",
      currentUsd: xrpValue,
      balance: data.xrpBalance,
      pricePerUnit: data.xrpPriceUsd,
    },
    ...data.tokenBreakdown
      .filter((t) => t.usd > 0)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 8)
      .map((t) => ({
        name: t.name,
        currentUsd: t.usd,
        balance: t.balance,
        pricePerUnit: t.balance > 0 ? t.usd / t.balance : 0,
      })),
  ];

  function getProjectedUsd(item: Item): number {
    const raw = inputs.get(item.name);
    if (!raw || raw.trim() === "") return item.currentUsd;

    const val = parseFloat(raw.replace(/,/g, ""));
    if (isNaN(val)) return item.currentUsd;

    if (mode === "pct") {
      return Math.max(0, item.currentUsd * (1 + val / 100));
    }
    // price mode: new price × balance
    return Math.max(0, val * item.balance);
  }

  function getPctChange(item: Item): number {
    if (item.currentUsd === 0) return 0;
    const projected = getProjectedUsd(item);
    return ((projected - item.currentUsd) / item.currentUsd) * 100;
  }

  // Totals
  const adjustedNames = new Set(items.map((i) => i.name));
  const otherTokensValue = data.tokenBreakdown
    .filter((t) => !adjustedNames.has(t.name) && t.usd > 0)
    .reduce((sum, t) => sum + t.usd, 0);
  const staticValue =
    data.ammValueUsd + data.lockedXrp * data.xrpPriceUsd + otherTokensValue;

  const projectedTotal =
    items.reduce((sum, item) => sum + getProjectedUsd(item), 0) + staticValue;
  const totalDelta = projectedTotal - data.totalValueUsd;
  const totalDeltaPct =
    data.totalValueUsd > 0 ? (totalDelta / data.totalValueUsd) * 100 : 0;
  const hasChanges = inputs.size > 0;

  function updateInput(name: string, value: string) {
    setInputs((prev) => {
      const next = new Map(prev);
      if (value === "" || value === "0") next.delete(name);
      else next.set(name, value);
      return next;
    });
  }

  function reset() {
    setInputs(new Map());
  }

  function switchMode(newMode: InputMode) {
    setMode(newMode);
    setInputs(new Map()); // clear on mode switch to avoid confusion
  }

  return (
    <div className="flex flex-col rounded-2xl shadow-card bg-surface">
      {/* Header */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between border-b border-elevated px-4 py-card-header focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 rounded-t-2xl"
      >
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">
          Price Simulator
        </span>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); reset(); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); reset(); } }}
              className="font-mono text-tag font-medium text-muted hover:text-secondary"
            >
              Reset
            </span>
          )}
          <ChevronDown
            size={14}
            className={cn(
              "text-muted transition-transform duration-200",
              !expanded && "-rotate-90",
            )}
          />
        </div>
      </button>

      {!expanded ? (
        <div className="px-4 py-3">
          <p className="font-mono text-cell text-muted">
            Enter target prices or percentage changes to model portfolio impact.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 px-4 py-4">
          {/* ── Before / After comparison ── */}
          <div className="grid grid-cols-2 gap-6">
            <div className="flex flex-col gap-1 rounded-xl bg-elevated px-4 py-3">
              <span className="font-display text-label font-medium uppercase tracking-header text-muted">
                Current
              </span>
              <span className="font-mono text-value font-medium tabular-nums text-primary">
                {formatVolume(data.totalValueUsd)}
              </span>
            </div>
            <div className="flex flex-col gap-1 rounded-xl bg-elevated px-4 py-3">
              <span className="font-display text-label font-medium uppercase tracking-header text-muted">
                Projected
              </span>
              <span
                className={cn(
                  "font-mono text-value font-medium tabular-nums",
                  !hasChanges
                    ? "text-primary"
                    : totalDelta >= 0
                      ? "text-success"
                      : "text-error",
                )}
              >
                {formatVolume(projectedTotal)}
              </span>
              {hasChanges && (
                <span
                  className={cn(
                    "font-mono text-tag font-semibold tabular-nums",
                    totalDelta >= 0 ? "text-success" : "text-error",
                  )}
                >
                  {totalDelta >= 0 ? "+" : ""}
                  {formatVolume(totalDelta)} ({totalDeltaPct >= 0 ? "+" : ""}
                  {totalDeltaPct.toFixed(1)}%)
                </span>
              )}
            </div>
          </div>

          {/* ── Mode toggle ── */}
          <div className="self-start">
            <Toggle
              options={[
                { value: "pct" as InputMode, label: "% Change" },
                { value: "price" as InputMode, label: "Target Price" },
              ]}
              active={mode}
              onChange={switchMode}
            />
          </div>

          {/* ── Per-token inputs ── */}
          <div className="overflow-hidden rounded-xl border border-elevated">
            {/* Table header — hidden on mobile */}
            <div className="hidden grid-cols-[1fr_100px_1fr] items-center gap-2 border-b border-elevated bg-elevated px-4 py-2 sm:grid">
              <span className="font-display text-label font-medium uppercase tracking-header text-muted">
                Token
              </span>
              <span className="text-center font-display text-label font-medium uppercase tracking-header text-muted">
                {mode === "pct" ? "Change %" : "Price $"}
              </span>
              <span className="text-right font-display text-label font-medium uppercase tracking-header text-muted">
                Result
              </span>
            </div>

            {items.map((item, i) => {
              const projected = getProjectedUsd(item);
              const pct = getPctChange(item);
              const changed = inputs.has(item.name);

              return (
                <div
                  key={item.name}
                  className={cn(
                    "flex flex-col gap-2 px-4 py-2.5 sm:grid sm:grid-cols-[minmax(0,1fr)_80px_minmax(0,1fr)] sm:items-center sm:gap-2",
                    i < items.length - 1 && "border-b border-elevated",
                  )}
                >
                  {/* Mobile: token + input on one row, result below */}
                  {/* Desktop: 3-column grid handled by parent */}

                  {/* Token name + current */}
                  <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-start sm:justify-start">
                    <span className="font-mono text-cell font-medium text-primary">
                      {item.name}
                    </span>
                    <span className="font-mono text-tag tabular-nums text-muted">
                      {mode === "price"
                        ? `$${item.pricePerUnit < 0.01 ? item.pricePerUnit.toPrecision(3) : item.pricePerUnit.toFixed(2)}`
                        : formatVolume(item.currentUsd)}
                    </span>
                  </div>

                  {/* Input */}
                  <div className="relative">
                    <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-cell text-muted">
                      {mode === "pct" ? "%" : "$"}
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={inputs.get(item.name) ?? ""}
                      onChange={(e) => updateInput(item.name, e.target.value)}
                      placeholder={mode === "pct" ? "0" : item.pricePerUnit.toFixed(2)}
                      aria-label={mode === "pct" ? `Percent change for ${item.name}` : `Target price for ${item.name}`}
                      className="w-full rounded-lg border border-elevated bg-elevated px-2.5 py-1.5 pl-7 font-mono text-cell tabular-nums text-primary outline-none transition-colors placeholder:text-muted/40 focus-visible:border-brand/40 focus-visible:ring-2 focus-visible:ring-brand/50"
                    />
                  </div>

                  {/* Result */}
                  <div className="flex items-center justify-between gap-2 sm:flex-col sm:items-end">
                    <span
                      className={cn(
                        "font-mono text-cell font-medium tabular-nums",
                        !changed
                          ? "text-secondary"
                          : pct >= 0
                            ? "text-success"
                            : "text-error",
                      )}
                    >
                      {formatVolume(projected)}
                    </span>
                    {changed && (
                      <span
                        className={cn(
                          "font-mono text-tag tabular-nums",
                          pct >= 0 ? "text-success/70" : "text-error/70",
                        )}
                      >
                        {pct >= 0 ? "+" : ""}
                        {Math.abs(pct) >= 100
                          ? `${pct.toFixed(0)}%`
                          : `${pct.toFixed(1)}%`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
