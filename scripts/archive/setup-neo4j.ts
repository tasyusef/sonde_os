/**
 * Neo4j schema setup — creates constraints, indexes, and verifies connectivity
 * for the intelligence layer graph database.
 *
 * Usage:
 *   npx tsx scripts/setup-neo4j.ts
 *
 * Requires NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD env vars.
 * Idempotent — safe to run multiple times.
 */

import neo4j from "neo4j-driver";

const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USER = process.env.NEO4J_USER ?? "neo4j";
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;

if (!NEO4J_URI || !NEO4J_PASSWORD) {
  console.error("NEO4J_URI and NEO4J_PASSWORD are required");
  process.exit(1);
}

const driver = neo4j.driver(NEO4J_URI, neo4j.auth.basic(NEO4J_USER, NEO4J_PASSWORD));

async function run(cypher: string, label: string) {
  console.log(`  [+] ${label}`);
  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.run(cypher);
  } finally {
    await session.close();
  }
}

async function main() {
  console.log(`Neo4j setup — ${NEO4J_URI}\n`);

  // Verify connectivity
  await driver.verifyConnectivity();
  console.log("  Connected.\n");

  // ── Constraints ───────────────────────────────────────────────────
  // Unique address per Account node — also creates an implicit index.
  await run(
    `CREATE CONSTRAINT account_address_unique IF NOT EXISTS
     FOR (a:Account) REQUIRE a.address IS UNIQUE`,
    "constraint: Account.address unique",
  );

  // ── Indexes ───────────────────────────────────────────────────────
  // Account lookup by first_seen / last_active for time-range queries.
  await run(
    `CREATE INDEX account_first_seen IF NOT EXISTS
     FOR (a:Account) ON (a.first_seen)`,
    "index: Account.first_seen",
  );

  await run(
    `CREATE INDEX account_last_active IF NOT EXISTS
     FOR (a:Account) ON (a.last_active)`,
    "index: Account.last_active",
  );

  // Relationship property indexes for time-filtered traversals.
  await run(
    `CREATE INDEX payment_timestamp IF NOT EXISTS
     FOR ()-[r:PAYMENT]-() ON (r.timestamp)`,
    "index: PAYMENT.timestamp",
  );

  await run(
    `CREATE INDEX dex_trade_timestamp IF NOT EXISTS
     FOR ()-[r:DEX_TRADE]-() ON (r.timestamp)`,
    "index: DEX_TRADE.timestamp",
  );

  await run(
    `CREATE INDEX trust_line_currency IF NOT EXISTS
     FOR ()-[r:TRUST_LINE]-() ON (r.currency)`,
    "index: TRUST_LINE.currency",
  );

  // ── Verify ────────────────────────────────────────────────────────
  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run("SHOW CONSTRAINTS");
    console.log(`\n  Constraints: ${result.records.length}`);
    const idxResult = await session.run("SHOW INDEXES");
    console.log(`  Indexes: ${idxResult.records.length}`);
  } finally {
    await session.close();
  }

  console.log("\nNeo4j setup complete.");
  await driver.close();
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
