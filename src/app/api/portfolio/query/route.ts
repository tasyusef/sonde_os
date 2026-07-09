import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, tokenCostBasis } from "@/db/schema";
import {
  requirePortfolioQueryAccess,
  checkAiRateLimit,
} from "@/lib/subscription";
import { createCompletion } from "@/lib/intel-ai-provider";
import { calculateCost } from "@/lib/ai-models";
import { buildPortfolioPrompt } from "@/lib/ai-prompts";
import { buildChartFromRows } from "@/lib/ai-chart-builder";
import { query as chQuery } from "@/lib/clickhouse-client";
import type { Visualization } from "@/types/intel";
import logger from "@/lib/logger";

interface Holding { currency: string; issuer: string; name: string; balance: number; usd: number }
interface DailyHistoryRow { day: string; total_value_usd: string | null }

/** Classify the user's question so we can pick the best chart shape. */
function classifyPortfolioIntent(q: string): "holdings" | "pnl" | "timeseries" {
  const s = q.toLowerCase();
  if (/\b(hold|holding|largest|biggest|top.*(token|hold)|allocation|breakdown|exposure)/.test(s)) return "holdings";
  if (/\b(pnl|p&l|profit|loss|realized|unrealized|win.?rate|gains|losses)/.test(s)) return "pnl";
  return "timeseries";
}

/**
 * Build a chart for the portfolio query response. Defaults to a time-series
 * of total portfolio value, but switches to holdings (pie/bar) or PnL (bar)
 * when the user's question implies those.
 */
function buildPortfolioViz(args: {
  question: string;
  breakdown: Holding[];
  rpMap: Map<string, number>;
  dailyHistory: DailyHistoryRow[];
}): Visualization | null {
  const intent = classifyPortfolioIntent(args.question);

  if (intent === "holdings") {
    const rows = args.breakdown
      .filter((t) => t.balance > 0 && t.usd > 0)
      .sort((a, b) => b.usd - a.usd)
      .slice(0, 8)
      .map((t) => ({ token: t.name, usd_value: Number(t.usd.toFixed(2)) }));
    return buildChartFromRows(rows, {
      titleHint: "Top holdings by USD value",
      preferredShape: "pie",
    });
  }

  if (intent === "pnl") {
    const rows = Array.from(args.rpMap.entries())
      .map(([key, pnl]) => {
        const [currency, issuer] = key.split(":");
        const match = args.breakdown.find((b) => b.currency === currency && b.issuer === issuer);
        return { token: match?.name ?? currency, realized_pnl_usd: Number(pnl.toFixed(2)) };
      })
      .filter((r) => r.realized_pnl_usd !== 0)
      .sort((a, b) => Math.abs(b.realized_pnl_usd) - Math.abs(a.realized_pnl_usd))
      .slice(0, 15);
    return buildChartFromRows(rows, { titleHint: "Realized PnL by token" });
  }

  // Default: portfolio value over time.
  const rows = args.dailyHistory.map((r) => ({
    day: r.day,
    total_value_usd: Number(r.total_value_usd ?? 0),
  }));
  return buildChartFromRows(rows, { titleHint: "Portfolio value — last 90 days" });
}

/**
 * POST /api/portfolio/query
 * Conversational AI scoped to the authenticated user's portfolio data.
 * Two access paths: Pro + BYOK (user's key) or Pro+AI (managed, rate limited).
 *
 * Body: { message: string }
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();

  let access: Awaited<ReturnType<typeof requirePortfolioQueryAccess>>;
  try {
    access = await requirePortfolioQueryAccess(cookieStore, request);
  } catch (err) {
    if (err instanceof Response) return err;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Rate limit for managed users (shares the 50/mo query bucket with intel_query).
  if (!access.usingBYOK) {
    try {
      await checkAiRateLimit(access.address, request, "portfolio_query");
    } catch (err) {
      if (err instanceof Response) return err;
      logger.error({ err, address: access.address }, "[portfolio/query] rate-limit check failed");
      return NextResponse.json({ error: "Internal error checking usage" }, { status: 500 });
    }
  }

  let body: { message: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message } = body;
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  // Get the API key — user's own (BYOK) or managed
  const apiKey = access.usingBYOK
    ? request.headers.get("x-anthropic-api-key")!
    : process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { error: access.usingBYOK ? "Invalid API key" : "AI service not configured" },
      { status: access.usingBYOK ? 401 : 503 },
    );
  }

  // Fetch the user's actual portfolio data for AI context
  let portfolioContext = "No portfolio data available yet.";
  let visualization: Visualization | null = null;
  try {
    const [snapshotRows, historyRows, dailyHistoryRows, costBasisRows, realizedPnlRows] = await Promise.all([
      // Latest snapshot from CH (Phase 3 of PG → CH migration).
      chQuery<{
        xrp_balance: string;
        xrp_price_usd: string;
        token_value_usd: string;
        nft_count: string;
        amm_value_usd: string;
        locked_xrp: string;
        total_value_usd: string;
        token_breakdown: string;
        snapshot_time: string;
      }>(
        `SELECT
           toString(xrp_balance)     AS xrp_balance,
           toString(xrp_price_usd)   AS xrp_price_usd,
           toString(token_value_usd) AS token_value_usd,
           toString(nft_count)       AS nft_count,
           toString(amm_value_usd)   AS amm_value_usd,
           toString(locked_xrp)      AS locked_xrp,
           toString(total_value_usd) AS total_value_usd,
           token_breakdown,
           toString(snapshot_time)   AS snapshot_time
         FROM portfolio_snapshots
         WHERE address = {addr:String}
         ORDER BY snapshot_time DESC
         LIMIT 1`,
        { addr: access.address },
      ),
      // Historical snapshots at ~1d, 7d, 30d, 90d ago (closest snapshot
      // ≤ each offset). CH doesn't have CROSS JOIN LATERAL, so we
      // express each checkpoint as its own subquery and UNION ALL —
      // each subquery finds the most recent row at-or-before its
      // offset via ORDER BY DESC LIMIT 1.
      //
      // Time column aliased `t` rather than `snapshot_time` because
      // CH 26+ resolves SELECT aliases inside subquery WHERE clauses
      // and a same-name `String` alias shadows the `DateTime` column,
      // erroring with NO_COMMON_TYPE on `snapshot_time <= now() - INTERVAL X DAY`.
      // (Same trap documented in `src/lib/holder-queries.ts`.)
      chQuery<{
        label: string;
        t: string;
        xrp_balance: string;
        xrp_price_usd: string;
        token_value_usd: string;
        amm_value_usd: string;
        locked_xrp: string;
        total_value_usd: string;
        nft_count: string;
      }>(
        `SELECT '1d' AS label, * FROM (
           SELECT
             toString(snapshot_time) AS t,
             toString(xrp_balance) AS xrp_balance,
             toString(xrp_price_usd) AS xrp_price_usd,
             toString(token_value_usd) AS token_value_usd,
             toString(amm_value_usd) AS amm_value_usd,
             toString(locked_xrp) AS locked_xrp,
             toString(total_value_usd) AS total_value_usd,
             toString(nft_count) AS nft_count
           FROM portfolio_snapshots
           WHERE address = {addr:String} AND snapshot_time <= now() - INTERVAL 1 DAY
           ORDER BY snapshot_time DESC LIMIT 1
         )
         UNION ALL
         SELECT '7d' AS label, * FROM (
           SELECT
             toString(snapshot_time) AS t,
             toString(xrp_balance) AS xrp_balance,
             toString(xrp_price_usd) AS xrp_price_usd,
             toString(token_value_usd) AS token_value_usd,
             toString(amm_value_usd) AS amm_value_usd,
             toString(locked_xrp) AS locked_xrp,
             toString(total_value_usd) AS total_value_usd,
             toString(nft_count) AS nft_count
           FROM portfolio_snapshots
           WHERE address = {addr:String} AND snapshot_time <= now() - INTERVAL 7 DAY
           ORDER BY snapshot_time DESC LIMIT 1
         )
         UNION ALL
         SELECT '30d' AS label, * FROM (
           SELECT
             toString(snapshot_time) AS t,
             toString(xrp_balance) AS xrp_balance,
             toString(xrp_price_usd) AS xrp_price_usd,
             toString(token_value_usd) AS token_value_usd,
             toString(amm_value_usd) AS amm_value_usd,
             toString(locked_xrp) AS locked_xrp,
             toString(total_value_usd) AS total_value_usd,
             toString(nft_count) AS nft_count
           FROM portfolio_snapshots
           WHERE address = {addr:String} AND snapshot_time <= now() - INTERVAL 30 DAY
           ORDER BY snapshot_time DESC LIMIT 1
         )
         UNION ALL
         SELECT '90d' AS label, * FROM (
           SELECT
             toString(snapshot_time) AS t,
             toString(xrp_balance) AS xrp_balance,
             toString(xrp_price_usd) AS xrp_price_usd,
             toString(token_value_usd) AS token_value_usd,
             toString(amm_value_usd) AS amm_value_usd,
             toString(locked_xrp) AS locked_xrp,
             toString(total_value_usd) AS total_value_usd,
             toString(nft_count) AS nft_count
           FROM portfolio_snapshots
           WHERE address = {addr:String} AND snapshot_time <= now() - INTERVAL 90 DAY
           ORDER BY snapshot_time DESC LIMIT 1
         )`,
        { addr: access.address },
      ),
      // Dense daily rollup (latest snapshot per day, last 90 days).
      // CH equivalent of `DISTINCT ON (day) ... ORDER BY day, time DESC`
      // is `LIMIT 1 BY toStartOfDay(snapshot_time)` after sorting.
      chQuery<{
        day: string;
        total_value_usd: string;
      }>(
        `SELECT
           formatDateTime(toStartOfDay(snapshot_time), '%F') AS day,
           toString(total_value_usd) AS total_value_usd
         FROM portfolio_snapshots
         WHERE address = {addr:String}
           AND snapshot_time >= now() - INTERVAL 90 DAY
         ORDER BY snapshot_time DESC
         LIMIT 1 BY toStartOfDay(snapshot_time)`,
        { addr: access.address },
      ),
      db
        .select({
          currency: tokenCostBasis.currency,
          issuer: tokenCostBasis.issuer,
          totalQty: tokenCostBasis.totalQtyAcquired,
          totalCostUsd: tokenCostBasis.totalCostUsd,
        })
        .from(tokenCostBasis)
        .where(sql`${tokenCostBasis.address} = ${access.address}`),
      db.execute<{ currency: string; issuer: string; realized_pnl: string }>(sql`
        SELECT currency, issuer, SUM(pnl_usd)::text AS realized_pnl
        FROM token_realized_pnl
        WHERE address = ${access.address}
        GROUP BY currency, issuer
      `),
    ]);

    if (snapshotRows.length > 0) {
      const snap = snapshotRows[0];
      const xrpBal = Number(snap.xrp_balance) || 0;
      const xrpPrice = Number(snap.xrp_price_usd) || 0;
      // CH stores token_breakdown as a JSON string. Parse client-side
      // (PG had it as JSONB and Drizzle auto-parsed).
      let breakdown: Array<{ currency: string; issuer: string; name: string; balance: number; usd: number }> = [];
      try {
        breakdown = snap.token_breakdown
          ? (JSON.parse(snap.token_breakdown) as typeof breakdown)
          : [];
      } catch {
        /* malformed — proceed empty */
      }

      // Build cost basis + realized PnL maps
      const cbMap = new Map<string, { avgCost: number }>();
      for (const row of costBasisRows) {
        const qty = Number(row.totalQty);
        if (qty > 0) cbMap.set(`${row.currency}:${row.issuer}`, { avgCost: Number(row.totalCostUsd) / qty });
      }
      const rpMap = new Map<string, number>();
      for (const row of realizedPnlRows) {
        rpMap.set(`${row.currency}:${row.issuer}`, Number(row.realized_pnl));
      }

      // Format token holdings
      const tokenLines = breakdown
        .filter((t) => t.balance > 0)
        .sort((a, b) => b.usd - a.usd)
        .slice(0, 30)
        .map((t) => {
          const key = `${t.currency}:${t.issuer}`;
          const cb = cbMap.get(key);
          const costBasis = cb ? t.balance * cb.avgCost : null;
          const unrealizedPnl = costBasis != null ? t.usd - costBasis : null;
          const realizedPnl = rpMap.get(key) ?? null;
          let line = `  ${t.name}: ${t.balance.toLocaleString()} (≈$${t.usd.toFixed(2)})`;
          if (unrealizedPnl != null) line += ` | unrealized PnL: ${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(2)}`;
          if (realizedPnl != null) line += ` | realized PnL: ${realizedPnl >= 0 ? "+" : ""}$${realizedPnl.toFixed(2)}`;
          return line;
        });

      // Historical totals — one row per checkpoint that actually has a snapshot.
      const historyLines = historyRows.map((h) => {
        const totalNow = Number(snap.total_value_usd ?? 0);
        const totalThen = Number(h.total_value_usd ?? 0);
        const delta = totalNow - totalThen;
        const pct = totalThen > 0 ? (delta / totalThen) * 100 : null;
        const xrpBalThen = Number(h.xrp_balance ?? 0);
        const xrpPriceThen = Number(h.xrp_price_usd ?? 0);
        const changeStr = pct != null
          ? ` (Δ ${delta >= 0 ? "+" : ""}$${delta.toFixed(2)}, ${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%)`
          : "";
        return `  ${h.label.padEnd(4)} ago — ${h.t}: total ≈$${totalThen.toFixed(2)}${changeStr} | XRP ${xrpBalThen.toLocaleString()} @ $${xrpPriceThen.toFixed(4)} | tokens ≈$${Number(h.token_value_usd ?? 0).toFixed(2)} | AMM ≈$${Number(h.amm_value_usd ?? 0).toFixed(2)} | NFTs ${h.nft_count ?? 0}`;
      });

      portfolioContext = [
        `Current snapshot (${snap.snapshot_time}):`,
        `  XRP balance: ${xrpBal.toLocaleString()} XRP (≈$${(xrpBal * xrpPrice).toFixed(2)} at $${xrpPrice.toFixed(4)}/XRP)`,
        `  Token value: ≈$${Number(snap.token_value_usd ?? 0).toFixed(2)}`,
        `  AMM/LP value: ≈$${Number(snap.amm_value_usd ?? 0).toFixed(2)}`,
        `  Locked XRP: ${Number(snap.locked_xrp ?? 0).toLocaleString()} XRP`,
        `  NFTs held: ${snap.nft_count ?? 0}`,
        `  Total portfolio value: ≈$${Number(snap.total_value_usd ?? 0).toFixed(2)}`,
        ``,
        historyLines.length > 0
          ? `Historical snapshots (deltas vs. current):\n${historyLines.join("\n")}`
          : `Historical snapshots: none available yet (account is new or hasn't been tracked long enough).`,
        ``,
        `Token holdings (top ${tokenLines.length}):`,
        ...tokenLines,
      ].join("\n");

      // Build a visualization matched to the user's intent.
      visualization = buildPortfolioViz({
        question: message,
        breakdown,
        rpMap,
        dailyHistory: dailyHistoryRows,
      });
    }
  } catch (err) {
    logger.warn({ err }, "[portfolio/query] Failed to fetch portfolio context");
    // Continue with empty context — the AI will note data is unavailable
  }

  try {
    const completion = await createCompletion({
      provider: "anthropic",
      apiKey,
      system: buildPortfolioPrompt(access.address, portfolioContext),
      messages: [{ role: "user", content: message }],
      maxTokens: 2048,
    });

    const reply = completion.text;
    const { inputTokens: tokensIn, outputTokens: tokensOut } = completion.usage;
    const cost = calculateCost(completion.model, tokensIn, tokensOut);

    // Track usage
    await db.insert(aiUsage).values({
      userAddress: access.address,
      queryType: "portfolio_query",
      model: completion.model,
      tokensIn,
      tokensOut,
      costUsd: sql`${cost.toFixed(6)}::numeric`,
    });

    return NextResponse.json({ reply, tokensIn, tokensOut, visualization });
  } catch (err) {
    // Map Anthropic SDK errors to HTTP responses. For BYOK users, surface
    // auth/rate-limit errors explicitly so they know to fix their own key.
    // For managed users, hide the specifics behind a generic 502.
    const status =
      err && typeof err === "object" && "status" in err && typeof err.status === "number"
        ? err.status
        : null;

    if (access.usingBYOK && status) {
      const errorMap: Record<number, { status: number; message: string }> = {
        401: { status: 401, message: "Invalid API key. Check your key in Settings." },
        403: { status: 403, message: "API key does not have access. Check your Anthropic account." },
        429: { status: 429, message: "Your Anthropic account is rate limited. Try again later." },
      };
      const mapped = errorMap[status] ?? { status: 502, message: "Anthropic API is temporarily unavailable." };
      return NextResponse.json({ error: mapped.message }, { status: mapped.status });
    }

    if (access.usingBYOK) {
      return NextResponse.json(
        { error: "Request timed out. Try a simpler query." },
        { status: 504 },
      );
    }

    logger.error({ err }, "[portfolio/query] Error");
    return NextResponse.json({ error: "AI query failed" }, { status: 500 });
  }
}
