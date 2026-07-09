import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!);

async function run() {
  const tokens = await sql`SELECT DISTINCT currency, issuer FROM token_volume_hourly ORDER BY currency LIMIT 30`;
  console.log("Distinct tokens in volume data:", tokens.length);
  for (const r of tokens) console.log("  ", r.currency, r.issuer ? r.issuer.slice(0, 12) + "..." : "(XRP)");

  const meta = await sql`SELECT COUNT(*) as cnt FROM token_metadata`;
  console.log("\nToken metadata rows:", meta[0].cnt);

  await sql.end();
}

run().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
