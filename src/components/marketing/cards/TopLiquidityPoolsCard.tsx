import { Card } from "@/components/shared/PreviewPrimitives";

/* ————————————————————————————————————————————
   Top liquidity pools (AMM) tweet card.

   Tweet format: top 5 XRPL AMM pools by total value locked. Distinct
   from the DEX pair card — that one ranks order-book trading volume,
   this one ranks on-chain liquidity sitting inside AMMs. Each pool is
   an account holding both assets with LP tokens representing shares.
   ———————————————————————————————————————————— */

export interface TopLiquidityPoolsCardProps {
  pools: {
    /** Non-XRP ticker in the pool, already decoded (e.g. "SOLO", "CSC"). */
    token: string;
    /** Paired asset — almost always "XRP" on XRPL AMMs. */
    paired: string;
    /** Total value locked in XRP (both sides combined). */
    tvlXrp: number;
    /** Trading fee in bps-style XRPL units (500 = 0.5%). */
    tradingFee: number;
  }[];
}

const DEFAULT_PROPS: TopLiquidityPoolsCardProps = {
  pools: [
    { token: "SOLO", paired: "XRP", tvlXrp: 4_820_000, tradingFee: 500 },
    { token: "CSC", paired: "XRP", tvlXrp: 3_140_000, tradingFee: 500 },
    { token: "CORE", paired: "XRP", tvlXrp: 2_260_000, tradingFee: 300 },
    { token: "XAH", paired: "XRP", tvlXrp: 1_870_000, tradingFee: 500 },
    { token: "USD", paired: "XRP", tvlXrp: 1_410_000, tradingFee: 250 },
  ],
};

function formatTvl(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatFee(bps: number): string {
  return `${(bps / 1000).toFixed(2)}%`;
}

export function TopLiquidityPoolsCard(
  props: Partial<TopLiquidityPoolsCardProps> = {},
) {
  const { pools } = { ...DEFAULT_PROPS, ...props };
  const maxTvl = Math.max(...pools.map((p) => p.tvlXrp), 1);

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between border-b border-elevated px-4 py-2.5">
        <span className="font-display text-tag font-bold uppercase tracking-header text-brand">
          Top Liquidity Pools
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted">
          AMM
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-elevated px-4 py-1.5">
        <span className="font-display text-tag uppercase tracking-header text-muted">
          Pool
        </span>
        <span className="font-display text-tag uppercase tracking-header text-muted text-right">
          Fee
        </span>
        <span className="w-[100px] font-display text-tag uppercase tracking-header text-muted text-right">
          TVL
        </span>
      </div>

      {/* Pool rows */}
      {pools.slice(0, 5).map((pool, i) => {
        const pct = (pool.tvlXrp / maxTvl) * 100;
        return (
          <div
            key={`${pool.token}-${pool.paired}-${i}`}
            className="relative grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-elevated px-4 py-2.5 last:border-b-0"
          >
            {/* TVL bar background */}
            <div
              className="absolute inset-y-0 left-0 bg-tx-amm/8"
              style={{ width: `${pct}%` }}
            />
            <span className="relative font-mono text-cell font-medium text-primary">
              {pool.token}{" "}
              <span className="text-muted">/</span>{" "}
              <span className="text-secondary">{pool.paired}</span>
            </span>
            <span className="relative font-mono text-cell tabular-nums text-muted text-right">
              {formatFee(pool.tradingFee)}
            </span>
            <span className="relative w-[100px] font-mono text-cell tabular-nums text-primary text-right">
              {formatTvl(pool.tvlXrp)} XRP
            </span>
          </div>
        );
      })}
    </Card>
  );
}

export default TopLiquidityPoolsCard;
