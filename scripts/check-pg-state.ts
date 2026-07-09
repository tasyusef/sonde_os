import { config } from "dotenv";
config({ path: ".env.local" });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, onnotice: () => {} });

  const state = await sql`SELECT key, value, updated_at FROM ingestion_state ORDER BY key`;
  console.log("ingestion_state:");
  for (const r of state) console.log(`  ${r.key} = ${r.value} (updated ${r.updated_at})`);

  const counts = await sql`SELECT count(*)::int AS n, max(last_seen_ledger) AS max_l, min(first_seen_ledger) AS min_l FROM account_tx_counts`;
  console.log(`\naccount_tx_counts: rows=${counts[0].n}, ledger range=[${counts[0].min_l}, ${counts[0].max_l}]`);

  await sql.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
