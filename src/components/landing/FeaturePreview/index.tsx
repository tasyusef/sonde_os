"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import PreviewHeader from "@/components/shared/PreviewHeader";
import {
  Card,
  PreviewAreaChart,
  Row,
  TypeTag,
} from "@/components/shared/PreviewPrimitives";
import Toggle from "@/components/shared/Toggle";
import { cn } from "@/lib/utils";

/* ————————————————————————————————————————————
   Static preview cards that mimic real Sonde UI.
   No live data — just hardcoded samples using
   the project's design tokens.

   Primitives (Card, Row, TypeTag, PreviewAreaChart) live in
   @/components/shared/PreviewPrimitives so the marketing tweet
   cards can reuse them. Toggle is the site-wide pill toggle
   primitive used by real chart components.
   ———————————————————————————————————————————— */

/* ——— Deterministic time-series generators ———
   Fixed base date so server + client hydration match. Each chart has a
   120-value base array that we slice by period — 7D / 30D / 90D / ALL —
   so toggling periods changes the chart shape without fetching anything. */

const DEMO_EPOCH_MS = new Date("2026-04-10T00:00:00Z").getTime();
const DAY_MS = 24 * 60 * 60 * 1000;

type Period = "7d" | "30d" | "90d" | "all";

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: "7d", label: "7D" },
  { value: "30d", label: "30D" },
  { value: "90d", label: "90D" },
  { value: "all", label: "ALL" },
];

function sliceByPeriod(values: number[], period: Period): number[] {
  switch (period) {
    case "7d":
      return values.slice(-7);
    case "30d":
      return values.slice(-30);
    case "90d":
      return values.slice(-90);
    case "all":
      return values;
  }
}

/**
 * Convert a raw numeric array to a dated time-series ending at DEMO_EPOCH_MS.
 * The last value aligns with the epoch; earlier values walk backwards
 * by `stepMs`. This keeps the most recent datapoint anchored regardless of
 * how much history we slice for the selected period.
 */
function seriesEndingAtEpoch(
  values: number[],
): { timestamp: number; value: number }[] {
  const n = values.length;
  return values.map((value, i) => ({
    timestamp: DEMO_EPOCH_MS - (n - 1 - i) * DAY_MS,
    value,
  }));
}

/**
 * Deterministic pseudo-random series with a smooth trend + layered sine noise.
 * Same (length, start, end, noiseAmp, seed) inputs always produce the same
 * output, so SSR and client hydration stay in sync without special handling.
 */
function generateSeries(
  length: number,
  start: number,
  end: number,
  noiseAmp: number,
  seed: number,
): number[] {
  return Array.from({ length }, (_, i) => {
    const t = i / (length - 1);
    const trend = start + (end - start) * t;
    const wave =
      Math.sin(i * 0.6 + seed) * 0.55 +
      Math.cos(i * 1.1 + seed * 2) * 0.3 +
      Math.sin(i * 2.2 + seed * 3) * 0.15;
    return Math.round((trend + wave * noiseAmp) * 100) / 100;
  });
}

function formatCompactXrp(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function sumOfValues(data: { value: number }[]): number {
  return data.reduce((s, d) => s + d.value, 0);
}

/* ——— Preview: Live Ledger Feed ——— */
export function LedgerFeedPreview() {
  const ledgers = [
    { index: "95,284,721", txs: 42, time: "3.8s", fees: "12.4 XRP" },
    { index: "95,284,720", txs: 37, time: "4.1s", fees: "9.8 XRP" },
    { index: "95,284,719", txs: 56, time: "3.5s", fees: "18.2 XRP" },
    { index: "95,284,718", txs: 29, time: "4.3s", fees: "7.1 XRP" },
  ];

  return (
    <Card>
      <div className="border-b border-elevated px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          <span className="font-display text-tag font-medium uppercase tracking-header text-success">
            Live
          </span>
        </div>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className="px-4 py-2 text-left font-display text-tag font-medium uppercase tracking-header text-muted">
              Ledger
            </th>
            <th scope="col" className="px-4 py-2 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
              Txs
            </th>
            <th scope="col" className="px-4 py-2 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
              Close
            </th>
            <th scope="col" className="px-4 py-2 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
              Fees
            </th>
          </tr>
        </thead>
        <tbody>
          {ledgers.map((l) => (
            <tr key={l.index} className="border-b border-elevated last:border-b-0">
              <td className="px-4 py-2.5 font-mono text-cell text-brand">{l.index}</td>
              <td className="px-4 py-2.5 text-right font-mono text-cell text-primary">{l.txs}</td>
              <td className="px-4 py-2.5 text-right font-mono text-cell text-secondary">{l.time}</td>
              <td className="px-4 py-2.5 text-right font-mono text-cell text-secondary">{l.fees}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ——— Preview: Account Explorer ——— */
export function AccountPreview() {
  return (
    <Card className="sm:min-w-[560px]">
      <PreviewHeader
        label="rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY"
        primaryValue="14,892.37 XRP"
        secondaryValue={<span className="text-success">+2.8%</span>}
      />
      <Row label="Reserve" value="12 XRP" />
      <Row label="Sequence" value="8,421,093" />
      <Row label="Domain" value="pepper.money" mono={false} />
      <Row label="Trust Lines" value="24" />
      <Row label="NFTs" value="7" />
      <Row label="Activated" value="Jan 14, 2022" mono={false} />
    </Card>
  );
}

/* ——— Preview: Transaction Viewer ——— */
export function TransactionPreview() {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-elevated px-4 py-3">
        <span className="font-mono text-cell text-brand">8A3F2...B91C</span>
        <TypeTag label="Payment" color="var(--color-tx-payment)" />
      </div>
      <Row label="From" value="rPEPPER7k...GDY" valueColor="text-brand" />
      <Row label="To" value="rBithomp...42a" valueColor="text-brand" />
      <Row label="Amount" value="1,250.00 XRP" valueColor="text-success" />
      <Row label="Fee" value="0.000012 XRP" />
      <Row label="Result" value="tesSUCCESS" valueColor="text-success" />
      <Row label="Ledger" value="95,284,718" />
    </Card>
  );
}

/* ——— Preview: Token Analytics ——— */
export function TokenPreview() {
  const tokens = [
    { name: "RLUSD", issuer: "Ripple", price: "0.7266", change: "+2.4%", changeColor: "text-success" },
    { name: "SOLO", issuer: "Sologenic", price: "0.0505", change: "+5.1%", changeColor: "text-success" },
    { name: "ARMY", issuer: "ARMY", price: "0.003549", change: "-1.2%", changeColor: "text-error" },
  ];

  return (
    <Card>
      <div className="border-b border-elevated px-4 py-3">
        <span className="font-display text-tag font-medium uppercase tracking-header text-muted">
          Top Tokens
        </span>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className="px-4 py-2 text-left font-display text-tag font-medium uppercase tracking-header text-muted">
              Token
            </th>
            <th scope="col" className="px-4 py-2 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
              Price
            </th>
            <th scope="col" className="px-4 py-2 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
              24h
            </th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => (
            <tr key={t.name} className="border-b border-elevated last:border-b-0">
              <td className="px-4 py-2.5">
                <span className="font-display text-cell font-bold text-primary">{t.name}</span>
                <span className="ml-2 font-mono text-label text-muted">{t.issuer}</span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-cell text-primary">
                {t.price} XRP
              </td>
              <td className={cn("px-4 py-2.5 text-right font-mono text-cell", t.changeColor)}>
                {t.change}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ——— Preview: NFT Gallery ——— */
export function NFTPreview() {
  const nfts = [
    { name: "Monkey Phunk #891", collection: "Monkey Phunks", image: "/nft/monkey-phunk.webp" },
    { name: "xShroom #342", collection: "xShrooms", image: "/nft/xshroom.webp" },
    { name: "XPunk #4217", collection: "XPunks", image: "/nft/xpunk.webp" },
  ];

  return (
    <Card>
      <div className="border-b border-elevated px-4 py-3">
        <span className="font-display text-tag font-medium uppercase tracking-header text-muted">
          NFT Gallery
        </span>
      </div>
      <div className="grid grid-cols-3 gap-px bg-elevated">
        {nfts.map((nft) => (
          <div key={nft.name} className="flex flex-col bg-surface p-3">
            <Image
              src={nft.image}
              alt={nft.name}
              width={120}
              height={120}
              className="mb-2 aspect-square w-full rounded-lg object-cover"
            />
            <span className="truncate font-display text-cell font-bold text-primary">{nft.name}</span>
            <span className="truncate font-display text-label text-muted">{nft.collection}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ——— Preview: Network Analytics ——— */
const FEE_BURN_BASE = generateSeries(120, 1_800, 6_900, 600, 1);

export function NetworkPreview() {
  const [period, setPeriod] = useState<Period>("30d");
  const data = useMemo(
    () => seriesEndingAtEpoch(sliceByPeriod(FEE_BURN_BASE, period)),
    [period],
  );
  const primaryValue = useMemo(
    () => `${formatCompactXrp(sumOfValues(data))} XRP`,
    [data],
  );
  return (
    <Card>
      <PreviewHeader
        label="Fee Burn Tracker"
        primaryValue={primaryValue}
        tertiaryLabel="Total: 1.24M XRP"
        rightSlot={
          <Toggle
            options={PERIOD_OPTIONS}
            active={period}
            onChange={setPeriod}
          />
        }
      />
      <div className="p-4">
        <PreviewAreaChart data={data} />
      </div>
    </Card>
  );
}

/* ——— Preview: DEX Analytics ——— */
const DEX_VOLUME_BASE = generateSeries(120, 110_000, 520_000, 55_000, 7);

export function DexAnalyticsPreview() {
  const [period, setPeriod] = useState<Period>("30d");
  const data = useMemo(
    () => seriesEndingAtEpoch(sliceByPeriod(DEX_VOLUME_BASE, period)),
    [period],
  );
  const primaryValue = useMemo(
    () => `${formatCompactXrp(sumOfValues(data))} XRP`,
    [data],
  );
  return (
    <Card>
      <PreviewHeader
        label="DEX Trade Volume"
        primaryValue={primaryValue}
        tertiaryLabel="12,847 trades"
        rightSlot={
          <Toggle
            options={PERIOD_OPTIONS}
            active={period}
            onChange={setPeriod}
          />
        }
      />
      <div className="p-4">
        <PreviewAreaChart data={data} />
      </div>
    </Card>
  );
}

/* ——— Preview: Payment Corridors ——— */
export function CorridorPreview() {
  const corridors = [
    { src: "XRP", dst: "RLUSD", volume: "482K XRP", count: "3,291" },
    { src: "USD", dst: "XRP", volume: "128K XRP", count: "892" },
    { src: "XRP", dst: "EUR", volume: "67K XRP", count: "421" },
    { src: "BTC", dst: "XRP", volume: "34K XRP", count: "187" },
  ];

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-elevated px-4 py-3">
        <span className="font-display text-tag font-bold uppercase tracking-header text-brand">
          Payment Corridors
        </span>
        <span className="font-mono text-cell text-muted">7D</span>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className="px-4 py-2 text-left font-display text-tag font-medium uppercase tracking-header text-muted">
              Route
            </th>
            <th scope="col" className="px-4 py-2 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
              Volume
            </th>
            <th scope="col" className="px-4 py-2 text-right font-display text-tag font-medium uppercase tracking-header text-muted">
              Txns
            </th>
          </tr>
        </thead>
        <tbody>
          {corridors.map((c) => (
            <tr key={`${c.src}-${c.dst}`} className="border-b border-elevated last:border-b-0">
              <td className="px-4 py-2.5">
                <span className="font-mono text-cell text-primary">{c.src}</span>
                <span className="mx-1.5 font-mono text-cell text-muted">→</span>
                <span className="font-mono text-cell text-primary">{c.dst}</span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-cell text-secondary">{c.volume}</td>
              <td className="px-4 py-2.5 text-right font-mono text-cell text-muted">{c.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ——— Preview: Portfolio Intelligence ——— */
const PORTFOLIO_VALUE_BASE = generateSeries(120, 18_500, 24_850, 420, 3);

function formatPortfolioValue(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
}

export function PortfolioPreview() {
  const [period, setPeriod] = useState<Period>("30d");
  const data = useMemo(
    () => seriesEndingAtEpoch(sliceByPeriod(PORTFOLIO_VALUE_BASE, period)),
    [period],
  );
  const { primaryValue, changePct } = useMemo(() => {
    const first = data[0]?.value ?? 0;
    const last = data[data.length - 1]?.value ?? 0;
    const pct = first > 0 ? ((last - first) / first) * 100 : 0;
    return {
      primaryValue: `${formatPortfolioValue(last)} XRP`,
      changePct: pct,
    };
  }, [data]);
  const changeColor = changePct >= 0 ? "text-success" : "text-error";
  const changeSign = changePct >= 0 ? "+" : "";

  return (
    <Card>
      <PreviewHeader
        label="rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY"
        primaryValue={primaryValue}
        secondaryValue={
          <span className={changeColor}>
            {changeSign}
            {changePct.toFixed(2)}%
          </span>
        }
        rightSlot={
          <Toggle
            options={PERIOD_OPTIONS}
            active={period}
            onChange={setPeriod}
          />
        }
      />
      <div className="p-4">
        <PreviewAreaChart
          data={data}
          color="var(--color-success)"
        />
      </div>
      <div className="border-t border-elevated">
        <Row label="Unrealized PnL" value="+2,841.20 XRP" valueColor="text-success" />
        <Row label="Realized PnL" value="+1,205.80 XRP" valueColor="text-success" />
        <Row label="Cost Basis (WAVG)" value="0.8712 XRP/USD" />
        <Row label="Positions" value="8 tokens + 2 AMM" />
      </div>
    </Card>
  );
}

/* ——— Preview: Smart Money ——— */
export function SmartMoneyPreview() {
  const wallets = [
    { rank: 1, addr: "rN7d4...kF92", score: 94, pnl: "+48,210", tier: "Elite", tierColor: "text-brand" },
    { rank: 2, addr: "rPqB8...xZ31", score: 89, pnl: "+31,450", tier: "Advanced", tierColor: "text-chart-blue" },
    { rank: 3, addr: "rT9mK...pV28", score: 85, pnl: "+22,180", tier: "Advanced", tierColor: "text-chart-blue" },
    { rank: 4, addr: "rWx3J...dR44", score: 78, pnl: "+14,920", tier: "Skilled", tierColor: "text-chart-emerald" },
  ];

  return (
    <Card>
      <div className="border-b border-elevated px-4 py-3">
        <span className="font-display text-tag font-bold uppercase tracking-header text-brand">
          Smart Money Leaderboard
        </span>
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-elevated">
            <th scope="col" className="px-4 py-2 text-left font-display text-tag font-medium uppercase tracking-header text-muted">#</th>
            <th scope="col" className="px-4 py-2 text-left font-display text-tag font-medium uppercase tracking-header text-muted">Wallet</th>
            <th scope="col" className="px-4 py-2 text-right font-display text-tag font-medium uppercase tracking-header text-muted">Score</th>
            <th scope="col" className="px-4 py-2 text-right font-display text-tag font-medium uppercase tracking-header text-muted">PnL (XRP)</th>
          </tr>
        </thead>
        <tbody>
          {wallets.map((w) => (
            <tr key={w.rank} className="border-b border-elevated last:border-b-0">
              <td className="px-4 py-2.5 font-mono text-cell text-muted">{w.rank}</td>
              <td className="px-4 py-2.5 font-mono text-cell text-brand">{w.addr}</td>
              <td className="px-4 py-2.5 text-right">
                <span className={cn("font-mono text-cell font-medium", w.tierColor)}>{w.score}</span>
                <span className={cn("ml-1.5 font-mono text-tag", w.tierColor)}>{w.tier}</span>
              </td>
              <td className="px-4 py-2.5 text-right font-mono text-cell text-success">{w.pnl}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

/* ——— Preview: Price Charts ——— */
const PRICE_BASE = generateSeries(120, 1.82, 2.41, 0.08, 11);

export function PricePreview() {
  const [period, setPeriod] = useState<Period>("30d");
  const data = useMemo(
    () => seriesEndingAtEpoch(sliceByPeriod(PRICE_BASE, period)),
    [period],
  );
  const { latestPrice, changePct } = useMemo(() => {
    const first = data[0]?.value ?? 0;
    const last = data[data.length - 1]?.value ?? 0;
    const pct = first > 0 ? ((last - first) / first) * 100 : 0;
    return { latestPrice: last, changePct: pct };
  }, [data]);
  const changeColor = changePct >= 0 ? "text-success" : "text-error";
  const changeSign = changePct >= 0 ? "+" : "";

  return (
    <Card>
      <PreviewHeader
        label="XRP"
        primaryValue={`$${latestPrice.toFixed(4)}`}
        secondaryValue={
          <span className={changeColor}>
            {changeSign}
            {changePct.toFixed(2)}%
          </span>
        }
        tertiaryLabel="Market Cap $137.2B"
        rightSlot={
          <Toggle
            options={PERIOD_OPTIONS}
            active={period}
            onChange={setPeriod}
          />
        }
      />
      <div className="p-4">
        <PreviewAreaChart
          data={data}
          formatY={(v) => `$${v.toFixed(2)}`}
        />
      </div>
    </Card>
  );
}
