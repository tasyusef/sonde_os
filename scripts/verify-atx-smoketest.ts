/**
 * Quick post-backfill sanity check for `account_tx_index`. Reports total
 * rows, distinct accounts/hashes, role distribution, and the top accounts
 * by row count — the same shape we eyeball after every slice-5a/5b run.
 *
 * Usage:
 *   pnpm exec tsx scripts/verify-atx-smoketest.ts                     # sonde_smoketest
 *   pnpm exec tsx scripts/verify-atx-smoketest.ts --db sonde          # prod
 */

import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@clickhouse/client";

const args = process.argv.slice(2);
function getArg(flag: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${flag}=`));
  if (eq) return eq.split("=", 2)[1];
  const idx = args.indexOf(flag);
  if (idx >= 0 && idx + 1 < args.length && !args[idx + 1].startsWith("--")) {
    return args[idx + 1];
  }
  return undefined;
}

const DB = getArg("--db") ?? "sonde_smoketest";

const ch = createClient({ url: process.env.CLICKHOUSE_URL!, database: DB });

(async () => {
  console.log(`[verify-atx] target=${DB}`);

  const r = await ch.query({
    query: `SELECT role, count() AS rows FROM ${DB}.account_tx_index GROUP BY role ORDER BY rows DESC`,
    format: "JSONEachRow",
  });
  console.log("role distribution:", await r.json());

  const total = await ch.query({
    query: `SELECT count() AS total, uniqExact(account) AS accounts, uniqExact(tx_hash) AS txs FROM ${DB}.account_tx_index`,
    format: "JSONEachRow",
  });
  console.log("totals:", await total.json());

  // Spot-check: pick a busy account from the index and look it up.
  const sample = await ch.query({
    query: `SELECT account, count() AS rows, arraySort(groupUniqArray(role)) AS roles FROM ${DB}.account_tx_index GROUP BY account ORDER BY rows DESC LIMIT 5`,
    format: "JSONEachRow",
  });
  console.log("top-5 accounts by index row count:", await sample.json());

  // Per-partition coverage — handy when paginating the prod run.
  const partitions = await ch.query({
    query: `SELECT toYYYYMM(timestamp) AS partition, count() AS rows
              FROM ${DB}.account_tx_index
              GROUP BY partition
              ORDER BY partition ASC`,
    format: "JSONEachRow",
  });
  console.log("rows per partition:", await partitions.json());

  await ch.close();
})();
