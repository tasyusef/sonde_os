import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  const checkpointRows = await sql`SELECT value FROM ingestion_state WHERE key = 'backfill_next_ledger'`;
  const intelLatest = await sql`SELECT value FROM ingestion_state WHERE key = 'intel_latest_ledger'`;
  const counterStats = await sql<{ n: string; txs: string; sent: string; received: string }[]>`
    SELECT count(*)::text AS n, sum(sent_count + received_count)::text AS txs,
           sum(sent_count)::text AS sent, sum(received_count)::text AS received
    FROM account_tx_counts
  `;
  console.log("backfill_next_ledger:", checkpointRows[0]?.value ?? "(unset)");
  console.log("intel_latest_ledger: ", intelLatest[0]?.value ?? "(unset)");
  console.log("counter rows:        ", counterStats[0].n);
  console.log("sum(sent+received):  ", counterStats[0].txs);
  console.log("sum sent:            ", counterStats[0].sent);
  console.log("sum received:        ", counterStats[0].received);
  await sql.end();
}
main().catch(e => { console.error(e); process.exit(1); });
