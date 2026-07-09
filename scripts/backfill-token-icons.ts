/**
 * Backfill token_metadata.icon from issuer XLS-26 TOML files.
 *
 * One-shot script. For each token missing an icon, fetches the issuer's
 * `.well-known/xrp-ledger.toml` and tries to pull the token's icon URL.
 * Concurrency-limited so we don't hammer the XRPL WS or random third-party
 * domains. Re-run safely — idempotent (only updates rows still missing icons).
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/backfill-token-icons.ts
 *
 * Env:
 *   BACKFILL_TOKEN_ICONS_CONCURRENCY=8   parallel TOML fetches (default 8)
 *   BACKFILL_TOKEN_ICONS_LIMIT=0         cap rows processed (0 = all)
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import postgres from "postgres";
import { resolveTokenIcon } from "@/lib/xls-26-toml";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[backfill-token-icons] DATABASE_URL required");
  process.exit(1);
}

const CONCURRENCY = parseInt(process.env.BACKFILL_TOKEN_ICONS_CONCURRENCY ?? "8", 10);
const LIMIT = parseInt(process.env.BACKFILL_TOKEN_ICONS_LIMIT ?? "0", 10);

let stopped = false;
process.on("SIGINT", () => {
  console.log("\n[backfill-token-icons] SIGINT received — finishing in-flight then stopping...");
  stopped = true;
});

interface Row {
  currency: string;
  issuer: string;
}

async function main() {
  const sql = postgres(DATABASE_URL!, { max: 4, onnotice: () => {} });
  try {
    const limitClause = LIMIT > 0 ? sql`LIMIT ${LIMIT}` : sql``;
    const rows = await sql<Row[]>`
      SELECT currency, issuer
      FROM token_metadata
      WHERE (icon IS NULL OR icon = '')
        AND issuer != ''
      ORDER BY holders DESC NULLS LAST
      ${limitClause}
    `;
    console.log(`[backfill-token-icons] ${rows.length.toLocaleString()} tokens missing icon`);
    if (rows.length === 0) return;

    let processed = 0;
    let resolved = 0;
    const start = Date.now();

    // Simple concurrency pool.
    const queue = [...rows];
    const workers: Promise<void>[] = [];

    const workOne = async () => {
      while (!stopped) {
        const row = queue.shift();
        if (!row) return;
        try {
          const icon = await resolveTokenIcon(row.currency, row.issuer);
          if (icon) {
            await sql`
              UPDATE token_metadata
              SET icon = ${icon}, updated_at = now()
              WHERE currency = ${row.currency} AND issuer = ${row.issuer}
            `;
            resolved++;
          }
        } catch (err) {
          // Catch-all: keep moving, individual TOML failures are fine.
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`  ${row.currency}:${row.issuer.slice(0, 8)}… failed: ${msg}`);
        }
        processed++;
        if (processed % 25 === 0 || processed === rows.length) {
          const rate = processed / ((Date.now() - start) / 1000);
          const remaining = rows.length - processed;
          const eta = rate > 0 ? remaining / rate / 60 : Infinity;
          console.log(
            `[backfill-token-icons] ${processed}/${rows.length} processed, ${resolved} resolved, ${rate.toFixed(1)}/s, eta ${eta.toFixed(1)}m`,
          );
        }
      }
    };

    for (let i = 0; i < CONCURRENCY; i++) workers.push(workOne());
    await Promise.all(workers);

    console.log(
      `[backfill-token-icons] done — processed ${processed}, resolved ${resolved} (${((resolved / processed) * 100).toFixed(1)}% hit rate)`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error("[backfill-token-icons] fatal:", err);
  process.exit(1);
});
