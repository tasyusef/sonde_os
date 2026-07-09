import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!);

  const [stats, top] = await Promise.all([
    sql<Array<{
      total: string;
      above_60: string;
      above_50: string;
      above_40: string;
      top: string;
      top_pnl: string;
      top_roi: string;
      median: string;
    }>>`
      SELECT count(*) AS total,
        count(*) FILTER (WHERE composite_score >= 60) AS above_60,
        count(*) FILTER (WHERE composite_score >= 50) AS above_50,
        count(*) FILTER (WHERE composite_score >= 40) AS above_40,
        max(composite_score) AS top,
        round(max(total_pnl_xrp::numeric), 2) AS top_pnl,
        round(max(roi_score::numeric), 2) AS top_roi,
        round(percentile_cont(0.5) WITHIN GROUP (ORDER BY composite_score::numeric)::numeric, 2) AS median
      FROM smart_money_scores
      WHERE scored_at > now() - INTERVAL '10 minutes'
    `,
    sql<Array<{
      address: string;
      composite_score: string;
      pnl: string;
      roi_score: string;
      profitability_score: string;
      tokens_traded: number;
    }>>`
      SELECT address,
        composite_score,
        round(total_pnl_xrp::numeric, 2) AS pnl,
        roi_score,
        profitability_score,
        tokens_traded
      FROM smart_money_scores
      WHERE scored_at > now() - INTERVAL '10 minutes'
      ORDER BY composite_score DESC
      LIMIT 10
    `,
  ]);

  console.log("=== STATS ===");
  console.log(JSON.stringify(stats[0], null, 2));

  console.log("\n=== TOP 10 ===");
  console.log(
    "addr             | comp | pnl_xrp    | roi  | prof | tok",
  );
  console.log(
    "-----------------+------+------------+------+------+----",
  );
  for (const r of top) {
    console.log(
      r.address.slice(0, 16).padEnd(16) + " | " +
      Number(r.composite_score).toFixed(1).padStart(4) + " | " +
      Number(r.pnl).toFixed(2).padStart(10) + " | " +
      Number(r.roi_score).toFixed(1).padStart(4) + " | " +
      Number(r.profitability_score).toFixed(0).padStart(4) + " | " +
      r.tokens_traded,
    );
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
