"use client";

import { useState } from "react";
import useSWR from "swr";
import Toggle from "@/components/shared/Toggle";
import { fetcher, CACHE_KEYS } from "@/lib/swr-config";
import { cn } from "@/lib/utils";
import { MULTI_SERIES_PALETTE } from "@/lib/chart-colors";
import type { CurrentPortfolio, NFTsResponse, TokensResponse, SliceData, View } from "./types";
import TreemapView from "./TreemapView";
import DonutView from "./DonutView";

const CATEGORY_COLORS: Record<string, string> = {
  "Liquid XRP": "var(--color-tx-payment)",
  Tokens: "var(--color-chart-blue)",
  "AMM / LP": "var(--color-tx-amm)",
  Locked: "var(--color-tx-escrow)",
  NFTs: "var(--color-tx-nft)",
};

const MAX_SLICES = 8;

export default function AllocationChart() {
  const [view, setView] = useState<View>("asset");

  const { data } = useSWR<CurrentPortfolio>(CACHE_KEYS.portfolioCurrent(), fetcher);
  const { data: nftData } = useSWR<NFTsResponse>(CACHE_KEYS.portfolioNfts(), fetcher);
  const { data: tokensData } = useSWR<TokensResponse>(
    view === "treemap" ? CACHE_KEYS.portfolioTokens() : null,
    fetcher,
  );

  if (!data) {
    return (
      <div className="flex h-full flex-col rounded-2xl shadow-card bg-surface">
        <div className="border-b border-elevated px-4 py-card-header">
          <span className="font-display text-label font-medium uppercase tracking-header text-muted">Allocation</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-8" role="status" aria-label="Loading allocation chart">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" />
        </div>
      </div>
    );
  }

  const xrpValue = data.xrpBalance * data.xrpPriceUsd;
  const lockedValue = data.lockedXrp * data.xrpPriceUsd;
  const nftValue = nftData?.totalValueUsd ?? 0;

  function buildAssetSlices(): SliceData[] {
    const total = data!.totalValueUsd || 1;
    const rawSlices: { name: string; value: number }[] = [{ name: "XRP", value: xrpValue }];

    const sortedTokens = [...data!.tokenBreakdown].sort((a, b) => b.usd - a.usd);
    for (const t of sortedTokens.slice(0, MAX_SLICES)) {
      if (t.usd > 0) rawSlices.push({ name: t.name, value: t.usd });
    }
    const otherValue = sortedTokens.slice(MAX_SLICES).reduce((sum, t) => sum + t.usd, 0);
    if (otherValue > 0) rawSlices.push({ name: "Other Tokens", value: otherValue });
    if (data!.ammValueUsd > 0) rawSlices.push({ name: "AMM / LP", value: data!.ammValueUsd });
    if (lockedValue > 0) rawSlices.push({ name: "Locked", value: lockedValue });

    return rawSlices
      .filter((s) => s.value > 0)
      .map((s, i) => ({ ...s, color: MULTI_SERIES_PALETTE[i % MULTI_SERIES_PALETTE.length], percentage: (s.value / total) * 100 }));
  }

  function buildTypeSlices(): SliceData[] {
    const total = xrpValue + data!.tokenValueUsd + data!.ammValueUsd + lockedValue + nftValue || 1;
    return [
      { label: "Liquid XRP", value: xrpValue },
      { label: "Tokens", value: data!.tokenValueUsd },
      { label: "AMM / LP", value: data!.ammValueUsd },
      { label: "Locked", value: lockedValue },
      { label: "NFTs", value: nftValue },
    ]
      .filter((c) => c.value > 0)
      .map((c) => ({ name: c.label, value: c.value, color: CATEGORY_COLORS[c.label], percentage: (c.value / total) * 100 }));
  }

  function buildTreemapData() {
    const items = [];
    if (xrpValue > 0) items.push({ name: "XRP", value: xrpValue, pnlPct: 0 });

    const pnlMap = new Map<string, number>();
    if (tokensData) {
      for (const t of tokensData.tokens) pnlMap.set(`${t.currency}:${t.issuer}`, t.pnlPct ?? 0);
    }
    for (const t of data!.tokenBreakdown) {
      if (t.usd <= 0) continue;
      items.push({ name: t.name, value: t.usd, pnlPct: pnlMap.get(`${t.currency}:${t.issuer}`) ?? 0 });
    }
    if (data!.ammValueUsd > 0) items.push({ name: "AMM / LP", value: data!.ammValueUsd, pnlPct: 0 });

    return items.sort((a, b) => b.value - a.value);
  }

  const slices = view === "treemap" ? [] : (view === "asset" ? buildAssetSlices() : buildTypeSlices());
  const maxValue = slices.reduce((m, s) => Math.max(m, s.value), 1);
  const treemapData = view === "treemap" ? buildTreemapData() : [];

  /* Concentration warnings */
  const totalForWarnings = xrpValue + data.tokenValueUsd + data.ammValueUsd + lockedValue + nftValue || 1;
  const concentratedTokens = data.tokenBreakdown
    .map((t) => ({ name: t.name, pct: (t.usd / totalForWarnings) * 100 }))
    .filter((t) => t.pct > 30)
    .sort((a, b) => b.pct - a.pct);

  const largestCategory = slices.length > 0
    ? slices.reduce((max, c) => (c.percentage > max.percentage ? c : max), slices[0])
    : undefined;
  const showCategoryWarning =
    view === "type" && concentratedTokens.length === 0 && largestCategory && largestCategory.percentage > 80;

  return (
    <div className="flex h-full flex-col rounded-2xl shadow-card bg-surface">
      {/* Header + toggle */}
      <div className="flex flex-col gap-3 border-b border-elevated px-4 py-card-header sm:flex-row sm:items-center sm:justify-between">
        <span className="font-display text-label font-medium uppercase tracking-header text-muted">Allocation</span>
        <Toggle
          options={[
            { value: "asset" as View, label: "By Asset" },
            { value: "type" as View, label: "By Type" },
            { value: "treemap" as View, label: "Treemap" },
          ]}
          active={view}
          onChange={setView}
        />
      </div>

      <div
        className="flex flex-col gap-4 px-4 py-4"
        role="tabpanel"
        aria-label={view === "treemap" ? "Allocation treemap" : view === "asset" ? "Allocation by asset" : "Allocation by type"}
      >
        {view === "treemap" && <TreemapView data={treemapData} />}
        {view !== "treemap" && (
          <DonutView slices={slices} totalValueUsd={data.totalValueUsd} maxValue={maxValue} />
        )}

        {/* Per-token concentration warnings */}
        {concentratedTokens.map((t) => (
          <div
            key={t.name}
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2",
              t.pct > 50 ? "border-error/20 bg-error/5" : "border-brand/20 bg-brand/5",
            )}
            role="alert"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className={cn("mt-0.5 shrink-0", t.pct > 50 ? "text-error" : "text-brand")}>
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className={cn("font-mono text-label", t.pct > 50 ? "text-error" : "text-secondary")}>
              <strong>{t.name}</strong> is {t.pct.toFixed(0)}% of your
              portfolio{t.pct > 50 ? " — high concentration risk" : " — consider diversifying"}
            </p>
          </div>
        ))}
        {showCategoryWarning && (
          <div className="flex items-start gap-2 rounded-lg border border-brand/20 bg-brand/5 px-3 py-2" role="status">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="mt-0.5 shrink-0 text-brand">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            <p className="font-mono text-label text-secondary">
              {largestCategory.percentage.toFixed(0)}% in <strong>{largestCategory.name}</strong> — consider diversifying
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
