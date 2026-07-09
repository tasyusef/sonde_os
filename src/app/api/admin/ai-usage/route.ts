/**
 * Admin-only endpoint: AI usage aggregates.
 *
 * Returns month-to-date stats on AI queries/investigations/portfolio queries:
 * - Overall totals (queries, tokens, cost)
 * - Breakdown by query type (with averages)
 * - Breakdown by model (to track cost impact of model swaps)
 * - Daily series over the last 30 days (for charting)
 */

import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireAdmin } from "@/lib/admin-auth";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  try {
    const [thisMonthRows, byQueryTypeRows, byModelRows, dailyRows] = await Promise.all([
      // Month-to-date totals
      db.execute<{
        total_queries: number;
        total_input_tokens: number | null;
        total_output_tokens: number | null;
        total_cost_usd: string | null;
      }>(sql`
        SELECT
          count(*)::int AS total_queries,
          sum(tokens_in)::int AS total_input_tokens,
          sum(tokens_out)::int AS total_output_tokens,
          sum(cost_usd)::text AS total_cost_usd
        FROM ai_usage
        WHERE created_at >= date_trunc('month', now())
      `),

      // Breakdown by query type
      db.execute<{
        query_type: string;
        count: number;
        total_tokens_in: number | null;
        total_tokens_out: number | null;
        avg_tokens_in: number | null;
        avg_tokens_out: number | null;
        total_cost_usd: string | null;
        avg_cost_usd: string | null;
      }>(sql`
        SELECT
          query_type,
          count(*)::int AS count,
          sum(tokens_in)::int AS total_tokens_in,
          sum(tokens_out)::int AS total_tokens_out,
          avg(tokens_in)::int AS avg_tokens_in,
          avg(tokens_out)::int AS avg_tokens_out,
          sum(cost_usd)::text AS total_cost_usd,
          avg(cost_usd)::text AS avg_cost_usd
        FROM ai_usage
        WHERE created_at >= date_trunc('month', now())
        GROUP BY query_type
        ORDER BY count DESC
      `),

      // Breakdown by model (rows with NULL model are legacy pre-migration rows)
      db.execute<{
        model: string | null;
        count: number;
        total_tokens_in: number | null;
        total_tokens_out: number | null;
        total_cost_usd: string | null;
      }>(sql`
        SELECT
          model,
          count(*)::int AS count,
          sum(tokens_in)::int AS total_tokens_in,
          sum(tokens_out)::int AS total_tokens_out,
          sum(cost_usd)::text AS total_cost_usd
        FROM ai_usage
        WHERE created_at >= date_trunc('month', now())
        GROUP BY model
        ORDER BY count DESC
      `),

      // Daily series (last 30 days)
      db.execute<{
        date: string;
        queries: number;
        input_tokens: number | null;
        output_tokens: number | null;
        cost_usd: string | null;
      }>(sql`
        SELECT
          date_trunc('day', created_at)::date::text AS date,
          count(*)::int AS queries,
          sum(tokens_in)::int AS input_tokens,
          sum(tokens_out)::int AS output_tokens,
          sum(cost_usd)::text AS cost_usd
        FROM ai_usage
        WHERE created_at >= now() - interval '30 days'
        GROUP BY 1
        ORDER BY 1
      `),
    ]);

    const tm = thisMonthRows[0];
    return NextResponse.json({
      thisMonth: {
        totalQueries: tm?.total_queries ?? 0,
        totalInputTokens: Number(tm?.total_input_tokens ?? 0),
        totalOutputTokens: Number(tm?.total_output_tokens ?? 0),
        totalCostUsd: Number(tm?.total_cost_usd ?? 0),
      },
      byQueryType: byQueryTypeRows.map((r) => ({
        queryType: r.query_type,
        count: r.count,
        totalTokensIn: Number(r.total_tokens_in ?? 0),
        totalTokensOut: Number(r.total_tokens_out ?? 0),
        avgTokensIn: Number(r.avg_tokens_in ?? 0),
        avgTokensOut: Number(r.avg_tokens_out ?? 0),
        totalCostUsd: Number(r.total_cost_usd ?? 0),
        avgCostUsd: Number(r.avg_cost_usd ?? 0),
      })),
      byModel: byModelRows.map((r) => ({
        model: r.model,
        count: r.count,
        totalTokensIn: Number(r.total_tokens_in ?? 0),
        totalTokensOut: Number(r.total_tokens_out ?? 0),
        totalCostUsd: Number(r.total_cost_usd ?? 0),
      })),
      daily: dailyRows.map((r) => ({
        date: r.date,
        queries: r.queries,
        inputTokens: Number(r.input_tokens ?? 0),
        outputTokens: Number(r.output_tokens ?? 0),
        costUsd: Number(r.cost_usd ?? 0),
      })),
    });
  } catch (err) {
    logger.error({ err }, "[admin/ai-usage]");
    return NextResponse.json({ error: "Failed to fetch AI usage metrics" }, { status: 500 });
  }
}
