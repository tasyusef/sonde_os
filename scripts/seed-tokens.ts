/**
 * seed-tokens.ts — Populate token_metadata from AMM pools + Bithomp issuer info.
 *
 * Self-contained: discovers tokens from the amm_pools table (already seeded),
 * fetches issuer names + avatars from Bithomp, and upserts into token_metadata.
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/seed-tokens.ts
 *
 * Re-running is safe (ON CONFLICT DO UPDATE).
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import postgres from "postgres";
import { decodeCurrency } from "../src/lib/xrpl-helpers";

const BITHOMP_BASE = "https://bithomp.com/api/v2";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const apiKey = process.env.BITHOMP_API_KEY;
if (!apiKey) {
  console.error("BITHOMP_API_KEY is required");
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 5 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface BithompAddressResponse {
  address: string;
  service?: {
    name?: string;
    domain?: string;
  };
  username?: string;
}

interface BithompAvatarResponse {
  originalImageUrl?: string;
  source?: string;
}

/** Fetch issuer service info + avatar from Bithomp */
async function fetchIssuerInfo(
  issuer: string,
): Promise<{ name: string | null; icon: string | null }> {
  try {
    const [addrRes, avatarRes] = await Promise.allSettled([
      fetch(`${BITHOMP_BASE}/address/${issuer}?service=true&username=true`, {
        headers: { "x-bithomp-token": apiKey! },
        signal: AbortSignal.timeout(10_000),
      }),
      fetch(`${BITHOMP_BASE}/avatar/${issuer}`, {
        headers: { "x-bithomp-token": apiKey! },
        signal: AbortSignal.timeout(10_000),
      }),
    ]);

    let name: string | null = null;
    let icon: string | null = null;

    if (addrRes.status === "fulfilled" && addrRes.value.ok) {
      const data = (await addrRes.value.json()) as BithompAddressResponse;
      name = data.service?.name ?? data.username ?? null;
    }

    if (avatarRes.status === "fulfilled" && avatarRes.value.ok) {
      const data = (await avatarRes.value.json()) as BithompAvatarResponse;
      if (data.source !== "blacklist" && data.originalImageUrl) {
        icon = data.originalImageUrl;
      }
    }

    return { name, icon };
  } catch {
    return { name: null, icon: null };
  }
}

async function run() {
  console.log("=== Seed Token Metadata ===\n");

  // Step 1: Discover tokens from amm_pools table
  console.log("Discovering tokens from amm_pools...\n");
  const tokens = await sql`
    SELECT DISTINCT
      CASE WHEN asset1_currency != 'XRP' THEN asset1_currency ELSE asset2_currency END AS currency,
      CASE WHEN asset1_currency != 'XRP' THEN asset1_issuer ELSE asset2_issuer END AS issuer
    FROM amm_pools
    WHERE (asset1_currency != 'XRP' OR asset2_currency != 'XRP')
    ORDER BY currency
  `;

  if (tokens.length === 0) {
    console.log("No tokens found in amm_pools. Run seed-amm-pools.ts first.");
    await sql.end();
    return;
  }

  console.log(`Found ${tokens.length} distinct tokens from AMM pools\n`);

  // Step 2: Fetch issuer info from Bithomp
  const issuerMap = new Map<string, { name: string | null; icon: string | null }>();
  const uniqueIssuers = [...new Set(tokens.map((t) => t.issuer as string).filter(Boolean))];

  console.log(`Fetching metadata for ${uniqueIssuers.length} unique issuers from Bithomp...\n`);

  let fetchCount = 0;
  for (const issuer of uniqueIssuers) {
    const info = await fetchIssuerInfo(issuer);
    issuerMap.set(issuer, info);
    fetchCount++;

    const displayIssuer = issuer.slice(0, 12) + "...";
    console.log(
      `  [${fetchCount}/${uniqueIssuers.length}] ${displayIssuer} → ${info.name ?? "(unknown)"}`,
    );

    // Rate limit: Bithomp free tier is 10 req/min, we make 2 per issuer = 5 issuers/min
    if (fetchCount < uniqueIssuers.length) {
      await sleep(6500);
    }
  }

  // Step 3: Upsert into token_metadata
  console.log("\nUpserting into token_metadata...");

  let upserted = 0;
  for (const token of tokens) {
    const currency = token.currency as string;
    const issuer = token.issuer as string;
    if (!currency || !issuer) continue;

    const issuerInfo = issuerMap.get(issuer) ?? { name: null, icon: null };
    const displayName = decodeCurrency(currency);

    await sql`
      INSERT INTO token_metadata (currency, issuer, name, icon, issuer_name, updated_at)
      VALUES (
        ${currency},
        ${issuer},
        ${displayName !== currency ? displayName : null},
        ${issuerInfo.icon},
        ${issuerInfo.name},
        NOW()
      )
      ON CONFLICT (currency, issuer) DO UPDATE SET
        name = COALESCE(EXCLUDED.name, token_metadata.name),
        icon = COALESCE(EXCLUDED.icon, token_metadata.icon),
        issuer_name = COALESCE(EXCLUDED.issuer_name, token_metadata.issuer_name),
        updated_at = NOW()
    `;
    upserted++;
  }

  console.log(`Upserted ${upserted} tokens\n`);

  // Step 4: Verify
  const count = await sql`SELECT COUNT(*) as cnt FROM token_metadata`;
  console.log(`Total token_metadata rows: ${count[0].cnt}`);

  const sample =
    await sql`SELECT currency, issuer, name, icon, issuer_name FROM token_metadata ORDER BY issuer_name NULLS LAST LIMIT 10`;
  console.log("\nSample:");
  for (const r of sample) {
    const decoded = decodeCurrency(r.currency as string);
    console.log(
      `  ${decoded.padEnd(12)} issuer=${(r.issuer_name as string) ?? "?"} icon=${r.icon ? "yes" : "no"}`,
    );
  }

  await sql.end();
  console.log("\nDone!");
}

run().catch(async (e) => {
  console.error("Fatal:", e.message);
  await sql.end();
  process.exit(1);
});
