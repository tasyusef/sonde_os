/**
 * One-off: query ClickHouse for monthly and daily active XRPL accounts
 * to ground a grant application figure. Uses the same mv_daily_active_accounts
 * materialized view that the network analytics page reads from.
 *
 * Usage: pnpm tsx scripts/check-active-accounts.ts
 * Requires CLICKHOUSE_URL in .env.local
 */

import { config } from "dotenv";
import { createClient } from "@clickhouse/client";

config({ path: ".env.local" });

const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? "http://localhost:8123";
const DATABASE = process.env.CLICKHOUSE_DATABASE ?? "sonde";

async function main() {
  const client = createClient({
    url: CLICKHOUSE_URL,
    database: DATABASE,
    request_timeout: 30_000,
  });

  console.log(`ClickHouse: ${new URL(CLICKHOUSE_URL).host}\n`);

  // Monthly active accounts (last 30 days)
  const monthly = await client.query({
    query: `
      SELECT uniqExactMerge(unique_accounts) AS active
      FROM ${DATABASE}.mv_daily_active_accounts
      WHERE day > today() - 30
    `,
    format: "JSONEachRow",
  });
  const monthlyRows = await monthly.json<{ active: number }>();
  const monthlyActive = Number(monthlyRows[0]?.active ?? 0);

  // Daily active accounts (yesterday)
  const daily = await client.query({
    query: `
      SELECT day, uniqExactMerge(unique_accounts) AS active
      FROM ${DATABASE}.mv_daily_active_accounts
      WHERE day > today() - 7
      GROUP BY day
      ORDER BY day DESC
    `,
    format: "JSONEachRow",
  });
  const dailyRows = await daily.json<{ day: string; active: number }>();

  // 7-day active
  const weekly = await client.query({
    query: `
      SELECT uniqExactMerge(unique_accounts) AS active
      FROM ${DATABASE}.mv_daily_active_accounts
      WHERE day > today() - 7
    `,
    format: "JSONEachRow",
  });
  const weeklyRows = await weekly.json<{ active: number }>();
  const weeklyActive = Number(weeklyRows[0]?.active ?? 0);

  console.log(`MONTHLY ACTIVE (30d):  ${monthlyActive.toLocaleString()}`);
  console.log(`WEEKLY ACTIVE  (7d):   ${weeklyActive.toLocaleString()}`);
  console.log(`\nDaily breakdown (last 7 days):`);
  for (const row of dailyRows) {
    console.log(`  ${row.day}  ${Number(row.active).toLocaleString()}`);
  }

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
