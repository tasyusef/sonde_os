import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { query as chQuery } from "@/lib/clickhouse-client";
import logger from "@/lib/logger";

interface TokenBreakdownEntry {
  currency: string;
  issuer: string;
  name: string;
  usd: number;
}

/** Time column aliased as `t` rather than `snapshot_time` to dodge CH 26+'s
 *  alias-shadowing-in-WHERE behavior (see history/route.ts for a fuller
 *  explainer). `WHERE snapshot_time > now() - INTERVAL X DAY` paired with
 *  `toString(snapshot_time) AS snapshot_time` errors with NO_COMMON_TYPE. */
interface SnapshotRow extends Record<string, unknown> {
  t: string;
  token_breakdown: string;
  xrp_balance: string;
  xrp_price_usd: string;
}

/**
 * GET /api/portfolio/correlation
 * Computes pairwise Pearson correlation between held tokens
 * using daily value changes from snapshot token_breakdown JSONB.
 */
export async function GET() {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch snapshots with token_breakdown from last 90 days. CH stores
    // token_breakdown as a JSON String — we parse it client-side.
    const rows = await chQuery<SnapshotRow>(
      `SELECT
         toString(snapshot_time) AS t,
         token_breakdown,
         toString(xrp_balance)   AS xrp_balance,
         toString(xrp_price_usd) AS xrp_price_usd
       FROM portfolio_snapshots
       WHERE address = {addr:String}
         AND snapshot_time > now() - INTERVAL 90 DAY
         AND token_breakdown != ''
       ORDER BY snapshot_time ASC`,
      { addr: session.address },
    );

    if (rows.length < 7) {
      return NextResponse.json({ matrix: [], tokens: [] });
    }

    // Parse JSON breakdowns once. Drop rows where parsing fails.
    const parsedRows = rows
      .map((r) => {
        let breakdown: TokenBreakdownEntry[] | null = null;
        try {
          breakdown = JSON.parse(r.token_breakdown) as TokenBreakdownEntry[];
        } catch {
          /* skip malformed */
        }
        return breakdown ? { ...r, breakdown } : null;
      })
      .filter((r): r is SnapshotRow & { breakdown: TokenBreakdownEntry[] } => r !== null);

    // Aggregate to daily: last snapshot per day
    const dailyMap = new Map<string, (typeof parsedRows)[number]>();
    for (const r of parsedRows) {
      const day = r.t.slice(0, 10);
      dailyMap.set(day, r);
    }

    const dailySnapshots = [...dailyMap.values()];
    if (dailySnapshots.length < 7) {
      return NextResponse.json({ matrix: [], tokens: [] });
    }

    // Collect all token keys that appear in at least half of snapshots
    const tokenAppearances = new Map<string, number>();
    const tokenNames = new Map<string, string>();

    for (const snap of dailySnapshots) {
      const breakdown = snap.breakdown;
      if (!breakdown) continue;
      for (const t of breakdown) {
        const key = `${t.currency}:${t.issuer}`;
        tokenAppearances.set(key, (tokenAppearances.get(key) ?? 0) + 1);
        tokenNames.set(key, t.name);
      }
    }

    // Include XRP as a "token" for correlation
    const minAppearances = Math.floor(dailySnapshots.length / 2);
    const tokenKeys = ["XRP", ...[...tokenAppearances.entries()]
      .filter(([, count]) => count >= minAppearances)
      .map(([key]) => key)
      .slice(0, 9)]; // Cap at 10 total (XRP + 9 tokens)

    const tokenLabels = ["XRP", ...tokenKeys.slice(1).map((k) => tokenNames.get(k) ?? k.split(":")[0])];

    if (tokenKeys.length < 2) {
      return NextResponse.json({ matrix: [], tokens: [] });
    }

    // Build daily value series per token
    const series: Map<string, number[]> = new Map();
    for (const key of tokenKeys) {
      series.set(key, []);
    }

    for (const snap of dailySnapshots) {
      const breakdown = snap.breakdown;
      const breakdownMap = new Map<string, number>();
      if (breakdown) {
        for (const t of breakdown) {
          breakdownMap.set(`${t.currency}:${t.issuer}`, t.usd);
        }
      }

      for (const key of tokenKeys) {
        if (key === "XRP") {
          const balance = parseFloat(snap.xrp_balance as string);
          const price = parseFloat(snap.xrp_price_usd as string);
          series.get(key)!.push(
            Number.isFinite(balance) && Number.isFinite(price) ? balance * price : 0,
          );
        } else {
          series.get(key)!.push(breakdownMap.get(key) ?? 0);
        }
      }
    }

    // Compute daily returns
    const returns: Map<string, number[]> = new Map();
    for (const [key, values] of series) {
      const r: number[] = [];
      for (let i = 1; i < values.length; i++) {
        if (values[i - 1] > 0) {
          r.push((values[i] - values[i - 1]) / values[i - 1]);
        } else {
          r.push(0);
        }
      }
      returns.set(key, r);
    }

    // Pearson correlation
    function pearson(a: number[], b: number[]): number {
      const n = Math.min(a.length, b.length);
      if (n < 3) return 0;

      const meanA = a.slice(0, n).reduce((s, v) => s + v, 0) / n;
      const meanB = b.slice(0, n).reduce((s, v) => s + v, 0) / n;

      let num = 0;
      let denA = 0;
      let denB = 0;
      for (let i = 0; i < n; i++) {
        const da = a[i] - meanA;
        const db = b[i] - meanB;
        num += da * db;
        denA += da * da;
        denB += db * db;
      }

      const den = Math.sqrt(denA * denB);
      return den === 0 ? 0 : num / den;
    }

    // Build NxN correlation matrix
    const matrix: number[][] = [];
    for (let i = 0; i < tokenKeys.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < tokenKeys.length; j++) {
        if (i === j) {
          row.push(1);
        } else {
          const ra = returns.get(tokenKeys[i])!;
          const rb = returns.get(tokenKeys[j])!;
          row.push(Math.round(pearson(ra, rb) * 100) / 100);
        }
      }
      matrix.push(row);
    }

    return NextResponse.json({ matrix, tokens: tokenLabels });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/portfolio/correlation] Error");
    return NextResponse.json(
      { error: "Failed to compute correlation" },
      { status: 500 },
    );
  }
}
