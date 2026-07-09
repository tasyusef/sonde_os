/**
 * seed-known-addresses.ts — Build verified known-addresses map from Bithomp + DB.
 *
 * 1. Queries Bithomp /address endpoint for a curated list of exchange addresses
 * 2. Pulls named issuers from our token_metadata DB table
 * 3. Writes verified results to src/lib/known-addresses.ts
 *
 * Usage:
 *   NODE_OPTIONS="--conditions react-server" npx tsx scripts/seed-known-addresses.ts
 *
 * Re-running overwrites the address map with fresh verified data.
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import * as fs from "fs";
import * as path from "path";
import postgres from "postgres";

const BITHOMP_BASE = "https://bithomp.com/api/v2";

const apiKey = process.env.BITHOMP_API_KEY;
if (!apiKey) {
  console.error("BITHOMP_API_KEY is required");
  process.exit(1);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface BithompAddressResponse {
  address: string;
  service?: {
    name?: string;
    domain?: string;
  };
  username?: string;
  inception?: string;
}

interface KnownEntry {
  address: string;
  name: string;
  type: "exchange" | "gateway" | "service" | "issuer" | "foundation" | "dex";
}

/* ------------------------------------------------------------------ */
/*  Curated candidate list — verified against Bithomp                  */
/* ------------------------------------------------------------------ */

const CANDIDATE_ADDRESSES = [
  // Bitstamp
  "rEb8TK3gBgk5auZkwc6sHnwrGVJH8DuaLh",
  "rrpNnNLKrartuEqfJGpqyDwPj1AFPg9vn1",
  "rGFuMiw48HdbnrUbkRYuitXTmfrDBNTCnX",
  "rDsbeomae4FXwgQTJp9Rs64Qg9vDiTCdBv",
  "rUobSiUpYH2S97Mgb4E4CD43CJbY1HPpio",
  // Bitfinex
  "rfkE1aSy9G8Upk4JssnwBxhEv5p4mn2KTy",
  "rLW9gnQo7BQhU6igk5keqYnH3TVrCxGRzm",
  // Kraken
  "rLHzPsX6oXkzU2qL12kHCH08ME3agErSPo",
  "rEy8TFcrAPvhpKrwyrscNYyqBGUkE9hKaJ",
  // Bitrue
  "rPb6CpzB43SDnRYuaCrh5c531mdnVY9iLm",
  "rwU8rAiE2eyEPz3sikfbHuqCuiAtdXB2r8",
  // Binance
  "rNxp4h8apvRis6mJf9Sh8C6iRxfrDWN7AV",
  "rEb3CsqKKigY4MRsFMoB8bYPSVZPqtGYze",
  "raQwCVAJVqjrVm1Nj5SFRcX8i22BhdC9WA",
  "rJJaLm8J7kCtb2u3Tg1VPBLuAMFQdEiLBs",
  // Uphold
  "rKsmLP6sTlVGDvga6rW6XbmSFUzc3G9f3",
  "rBDvMCqcnFBGJXJxDdnMgNLw4ms9MnPB1r",
  "rGfmCruNrmYbEhZFfRi3eqkMz53s6h8Bmy",
  // Coinbase
  "rJb5KsHsDHF1YS5B5DU6QCkH5NsPaQ2YRK",
  "r9dUBYJnrsf7ocXRXakbRLcn7wfRhFqG5K",
  // KuCoin
  "raKNjR8Rs4k5MoQz8oMJ3eFkEkCNJFBeAX",
  // Bybit
  "rwfGzgd1GrErpNJAcMeB6fLuPE3qiTkhNy",
  // Huobi / HTX
  "rDbWJ9C7uExThZYAwV8m6LsZ5YSX3sa6US",
  "rKontEGtDju5MCEJCwtrvTWQQqVAw5juXe",
  // Gate.io
  "rU7QEBp5MtsvXtv6tFsUMo3GReQPdg4AUo",
  // Crypto.com
  "rNQEMJA4PsoSrZRn9J6RajAYhcDzzhf8ok",
  // OKX
  "rHcFoo6a9qT5NHiVn1THQRhsEGcxtYCV4d",
  // Bithumb
  "rBTwLga3i5mgaJisSPMgDFHb3Ea1BsCWdh",
  // Ripple
  "r3kmLJN5D28dHuH8vZNUZpMC43pEHpaocV",
  "rHWcuuZoFvDS6gNbmHSdpb7u1hZzxvCoMt",
  "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY",
  "rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh",
  // GateHub
  "rvYAfWj5gh67oV6fW32ZzP3Aw4Eubs59B",
  "rhub8VRN55s94qWKDv6jmDy1pUykJzF3wq",
  // Sologenic
  "rsoLo2S1kiGEcARWpoowMF2o5tRk2t5GaP",
  // XRP Tip Bot
  "rXRPTipBotDVeYV14SXbBz6FHbRbRp4CqH",
  // XRPL Foundation / XRP Scan
  "rN7v3dWsKePAGtCqLhgJAGp4VpsTHkQPRh",
  // Bitgo
  "rU2mEJSLqBRkYLVTv55rFTgQajkLTnT6mA",
  // Wirex
  "rHDJqpEMr3EFbhKBN1gEid6Fd8bG2mYiSH",
  // Nexo
  "rM8UE2w3pfghzavQ9oGtADjPMMjPiNCZ1T",
  // Celsius
  "rQhWct2fv4Vc4KRjRgMrxa5ZZwNDmzkisc",
  // Poloniex
  "rJnZ4YHCUsHvQu7R6mZohevKJDHFzVD6Zr",
  // FTX (defunct, still labeled)
  "rKapBdRpmk5wfusXTnvR6gvSu6NMm2Rc7c",
  // CoinPayments
  "rHoL1n7mJv8tEjDvbDUMnUMft3vJpqxPbz",
  // BitPay
  "rEoQuo41UAzJiETHv7P2G6iEoKrTXLJXgU",
];

/* ------------------------------------------------------------------ */
/*  Fetch service info from Bithomp                                    */
/* ------------------------------------------------------------------ */

async function fetchAddressInfo(address: string): Promise<{
  name: string | null;
  domain: string | null;
}> {
  try {
    const res = await fetch(
      `${BITHOMP_BASE}/address/${address}?service=true&username=true`,
      {
        headers: { "x-bithomp-token": apiKey! },
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!res.ok) return { name: null, domain: null };
    const data = (await res.json()) as BithompAddressResponse;
    return {
      name: data.service?.name ?? data.username ?? null,
      domain: data.service?.domain ?? null,
    };
  } catch {
    return { name: null, domain: null };
  }
}

/* ------------------------------------------------------------------ */
/*  Classify type from name heuristics                                 */
/* ------------------------------------------------------------------ */

const EXCHANGE_KEYWORDS = [
  "bitstamp", "bitfinex", "kraken", "bitrue", "binance", "uphold",
  "coinbase", "kucoin", "bybit", "huobi", "htx", "gate.io", "crypto.com",
  "okx", "bithumb", "poloniex", "ftx", "bitget", "mexc", "lbank",
  "bittrex", "gemini", "nexo", "celsius", "bitgo", "wirex", "coinpayments",
  "bitpay",
];

const GATEWAY_KEYWORDS = ["gatehub", "bitstamp"];
const FOUNDATION_KEYWORDS = ["ripple", "xrpl foundation"];

function classifyType(name: string): KnownEntry["type"] {
  const lower = name.toLowerCase();
  if (FOUNDATION_KEYWORDS.some((k) => lower.includes(k))) return "foundation";
  if (GATEWAY_KEYWORDS.some((k) => lower.includes(k))) return "gateway";
  if (EXCHANGE_KEYWORDS.some((k) => lower.includes(k))) return "exchange";
  return "service";
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

async function run() {
  console.log("=== Seed Known Addresses ===\n");

  const verified: KnownEntry[] = [];

  // Phase 1: Verify candidate addresses via Bithomp
  console.log(`Checking ${CANDIDATE_ADDRESSES.length} candidate addresses against Bithomp...\n`);

  for (let i = 0; i < CANDIDATE_ADDRESSES.length; i++) {
    const address = CANDIDATE_ADDRESSES[i];
    const { name } = await fetchAddressInfo(address);

    if (name) {
      const type = classifyType(name);
      verified.push({ address, name, type });
      console.log(`  ✓ ${address} → ${name} (${type})`);
    } else {
      console.log(`  ✗ ${address} → no service name`);
    }

    // Rate limit: Bithomp free tier = 10 req/min → ~6.5s between requests
    // Paid tier is faster, but let's be safe
    if (i < CANDIDATE_ADDRESSES.length - 1) {
      await sleep(6500);
    }
  }

  // Phase 2: Pull named issuers from DB (if available)
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    console.log("\nFetching named issuers from token_metadata...");
    const sql = postgres(dbUrl, { max: 3 });
    try {
      const rows = await sql`
        SELECT DISTINCT issuer, issuer_name
        FROM token_metadata
        WHERE issuer_name IS NOT NULL
          AND issuer_name != ''
      `;
      for (const row of rows) {
        const addr = row.issuer as string;
        // Don't overwrite Bithomp-verified entries
        if (!verified.some((v) => v.address === addr)) {
          verified.push({
            address: addr,
            name: row.issuer_name as string,
            type: "issuer",
          });
        }
      }
      console.log(`  Added ${rows.length} issuers from DB`);
      await sql.end();
    } catch (e) {
      console.log(`  DB fetch failed: ${(e as Error).message}`);
    }
  } else {
    console.log("\nNo DATABASE_URL — skipping DB issuers");
  }

  // Phase 3: Deduplicate by address (first entry wins)
  const seen = new Set<string>();
  const deduped = verified.filter((v) => {
    if (seen.has(v.address)) return false;
    seen.add(v.address);
    return true;
  });

  // Sort by name for readability
  deduped.sort((a, b) => a.name.localeCompare(b.name));

  // Phase 4: Write to known-addresses.ts
  console.log(`\nWriting ${deduped.length} verified addresses to known-addresses.ts...\n`);

  const entries = deduped
    .map((e) => `  ${JSON.stringify(e.address)}: { name: ${JSON.stringify(e.name)}, type: ${JSON.stringify(e.type)} },`)
    .join("\n");

  const output = `/**
 * Known XRPL addresses — exchanges, gateways, services, issuers.
 * Auto-generated by scripts/seed-known-addresses.ts — do not edit manually.
 *
 * Last seeded: ${new Date().toISOString().split("T")[0]}
 * Source: Bithomp API + token_metadata DB
 */

export interface KnownAddress {
  name: string;
  type: "exchange" | "gateway" | "service" | "issuer" | "foundation" | "dex";
}

const KNOWN_ADDRESSES: Record<string, KnownAddress> = {
${entries}
};

/**
 * Look up a known address label.
 * Returns null if the address is not in the map.
 */
export function getKnownAddress(address: string): KnownAddress | null {
  return KNOWN_ADDRESSES[address] ?? null;
}

/**
 * Get just the display name for a known address.
 */
export function getKnownName(address: string): string | null {
  return KNOWN_ADDRESSES[address]?.name ?? null;
}

/**
 * Detect account type from flags and settings.
 * Returns a human-readable label and style category.
 */
export function getAccountType(flags: number, settings: {
  regularKey?: string;
  transferRate?: number;
  domain?: string;
  nfTokenMinter?: string;
}): { label: string; category: "amm" | "issuer" | "nft-issuer" | "regular" } {
  // AMM account (lsfAMM = 0x40000000)
  if ((flags & 0x40000000) !== 0) {
    return { label: "AMM Pool", category: "amm" };
  }

  // NFT issuer (has minted NFTs or has authorized minter)
  if (settings.nfTokenMinter) {
    return { label: "NFT Issuer", category: "nft-issuer" };
  }

  // Token issuer (has transferRate set or defaultRipple enabled)
  const hasDefaultRipple = (flags & 0x00800000) !== 0;
  if (settings.transferRate || hasDefaultRipple) {
    return { label: "Token Issuer", category: "issuer" };
  }

  return { label: "Account", category: "regular" };
}
`;

  const outPath = path.resolve(__dirname, "../src/lib/known-addresses.ts");
  fs.writeFileSync(outPath, output, "utf-8");

  console.log(`Done! Wrote ${deduped.length} entries to src/lib/known-addresses.ts`);

  // Print summary by type
  const byType: Record<string, number> = {};
  for (const e of deduped) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
  }
  console.log("\nBreakdown:");
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`);
  }
}

run().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
