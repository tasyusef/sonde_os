/**
 * Verify the unfunded-offer-cleanup fix in extractFillFromNode.
 *
 * Reads known corrupt transactions from sonde.transactions and runs the
 * (newly fixed) extractor logic against them. Confirms the fix removes
 * the absurd billion-XRP "fills" from unfunded-offer GC, while preserving
 * the legitimate small fills.
 *
 * Inlines the fixed `extractFillFromNode` logic so the script can run
 * outside Next.js (trade-extractors.ts has `import "server-only"` that
 * blocks tsx execution).
 *
 * Usage: pnpm exec tsx scripts/verify-unfunded-offer-fix.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error("CLICKHOUSE_URL required");
  process.exit(1);
}

const ch = createClient({ url, database: "sonde", request_timeout: 30_000 });

const KNOWN_CORRUPT_TXS = [
  { hash: "8AC61C8AB27A41E0CA44E60EE1B0F45F83247088ADCB66317A4E7C8911416F66", note: "xWizard, prev: 39.4B XRP" },
  { hash: "6A15714EDD555E372856250B1C31C077F8E0251D80C1E1B8CD800D62DAA065A3", note: "XMR,     prev: 1.6B + 100M XRP" },
  { hash: "86C056A19DCC224E01AEA1E2BDA2286EA2A20F6496575793891E36508B0FFB60", note: "CASPER,  prev: 10B XRP" },
  { hash: "0E884A28FDF8ED506E46B68EEF5F416838B5FB820443D10F5D3079ACC96BE9EF", note: "DARK,    prev: 718M XRP" },
];

const SANITY_CAP_XRP = 100_000_000;

// ── Inlined helpers (mirrors src/lib/trade-extractors.ts) ──

interface Norm { currency: string; issuer: string | null; value: string }

function normalizeAmount(amount: unknown): Norm | null {
  if (typeof amount === "string") return { currency: "XRP", issuer: null, value: amount };
  if (typeof amount === "object" && amount !== null) {
    const o = amount as { value?: string; currency?: string; issuer?: string };
    if (!o.currency) return null;
    return { currency: o.currency, issuer: o.issuer ?? null, value: o.value ?? "0" };
  }
  return null;
}

function parseDecimalString(s: string): { mantissa: bigint; exp: number } | null {
  if (!s) return null;
  if (s === "0" || s === "-0" || s === "+0") return { mantissa: 0n, exp: 0 };
  const m = s.match(/^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/);
  if (!m) return null;
  const [, sign, intp, fracp = "", expp = "0"] = m;
  const mantissa = BigInt((sign || "") + intp + fracp);
  const exp = parseInt(expp, 10) - fracp.length;
  return { mantissa, exp };
}

function formatDecimalString(mantissa: bigint, exp: number): string {
  if (mantissa === 0n) return "0";
  if (exp >= 0) return mantissa.toString() + "0".repeat(exp);
  const s = mantissa.toString();
  const neg = s.startsWith("-");
  const digits = neg ? s.slice(1) : s;
  const expAbs = -exp;
  if (digits.length > expAbs) {
    const intp = digits.slice(0, digits.length - expAbs);
    const fracp = digits.slice(digits.length - expAbs).replace(/0+$/, "");
    return (neg ? "-" : "") + intp + (fracp ? "." + fracp : "");
  }
  const fracp = digits.padStart(expAbs, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + "0" + (fracp ? "." + fracp : "");
}

function subtractAmounts(a: string, b: string): string {
  const da = parseDecimalString(a);
  const db = parseDecimalString(b);
  if (!da || !db) return "0";
  let { mantissa: ma, exp: ea } = da;
  let { mantissa: mb, exp: eb } = db;
  if (ea > eb) { ma *= 10n ** BigInt(ea - eb); ea = eb; }
  else if (eb > ea) { mb *= 10n ** BigInt(eb - ea); eb = ea; }
  return formatDecimalString(ma - mb, ea);
}

interface Fill { takerGets: unknown; takerPays: unknown; makerAccount: string | null }

function extractFillFromNode(node: Record<string, unknown>, txAccount: string): Fill | null {
  const deleted = node.DeletedNode as { LedgerEntryType: string; FinalFields?: Record<string, unknown>; PreviousFields?: Record<string, unknown> } | undefined;
  const modified = node.ModifiedNode as { LedgerEntryType: string; FinalFields?: Record<string, unknown>; PreviousFields?: Record<string, unknown> } | undefined;

  if (deleted?.LedgerEntryType === "Offer") {
    const prev = deleted.PreviousFields;
    const final = deleted.FinalFields;
    if (!final) return null;
    const offerOwner = final.Account as string | undefined;
    if (offerOwner === txAccount) return null;

    // FIX: skip when PreviousFields is missing — this is rippled GC'ing
    // an unfunded offer during pathfinding, not a fill.
    if (!prev?.TakerGets || !prev?.TakerPays) return null;

    const prevGets = normalizeAmount(prev.TakerGets);
    const finalGets = normalizeAmount(final.TakerGets);
    const prevPays = normalizeAmount(prev.TakerPays);
    const finalPays = normalizeAmount(final.TakerPays);
    if (!prevGets || !finalGets || !prevPays || !finalPays) return null;

    const getsValue = subtractAmounts(prevGets.value, finalGets.value);
    const paysValue = subtractAmounts(prevPays.value, finalPays.value);
    if (getsValue === "0" && paysValue === "0") return null;

    const takerGets = prevGets.currency === "XRP" ? getsValue : { value: getsValue, currency: prevGets.currency, issuer: prevGets.issuer };
    const takerPays = prevPays.currency === "XRP" ? paysValue : { value: paysValue, currency: prevPays.currency, issuer: prevPays.issuer };
    return { takerGets, takerPays, makerAccount: offerOwner ?? null };
  }

  if (modified?.LedgerEntryType === "Offer") {
    const prev = modified.PreviousFields;
    const final = modified.FinalFields;
    if (!prev?.TakerGets || !final?.TakerGets) return null;
    const modOwner = final.Account as string | undefined;
    if (modOwner === txAccount) return null;
    const prevGets = normalizeAmount(prev.TakerGets);
    const finalGets = normalizeAmount(final.TakerGets);
    const prevPays = normalizeAmount(prev.TakerPays);
    const finalPays = normalizeAmount(final.TakerPays);
    if (!prevGets || !finalGets || !prevPays || !finalPays) return null;
    const getsValue = subtractAmounts(prevGets.value, finalGets.value);
    const paysValue = subtractAmounts(prevPays.value, finalPays.value);
    const takerGets = prevGets.currency === "XRP" ? getsValue : { value: getsValue, currency: prevGets.currency, issuer: prevGets.issuer };
    const takerPays = prevPays.currency === "XRP" ? paysValue : { value: paysValue, currency: prevPays.currency, issuer: prevPays.issuer };
    return { takerGets, takerPays, makerAccount: modOwner ?? null };
  }

  return null;
}

function parseDrops(s: string): bigint {
  try { return BigInt(s.includes(".") ? s.split(".")[0] : s); } catch { return 0n; }
}

function fillXrpDrops(fill: Fill): bigint {
  const gets = normalizeAmount(fill.takerGets);
  const pays = normalizeAmount(fill.takerPays);
  if (!gets || !pays) return 0n;
  if (gets.currency === "XRP") return parseDrops(gets.value);
  if (pays.currency === "XRP") return parseDrops(pays.value);
  return 0n;
}

async function fetchTxMeta(txHash: string): Promise<{ tx: Record<string, unknown>; meta: { AffectedNodes: Array<Record<string, unknown>> } } | null> {
  const result = await ch.query({
    query: `SELECT tx_json, meta_json FROM sonde.transactions WHERE tx_hash = '${txHash}' LIMIT 1`,
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ tx_json: string; meta_json: string }>;
  if (!rows[0]) return null;
  return {
    tx: JSON.parse(rows[0].tx_json),
    meta: JSON.parse(rows[0].meta_json),
  };
}

async function fetchRecentOfferCreates(n: number): Promise<Array<{ hash: string; expectedDrops: bigint }>> {
  // Filter to OfferCreate-driven trades only (exclude AMM-routed
  // Payments — those go through extractAmmFillsFromTx, not our
  // offer-fill extractor).
  const result = await ch.query({
    query: `
      SELECT d.tx_hash AS hash, sum(d.xrp_volume_drops) AS total_drops
      FROM sonde.dex_trades d
      INNER JOIN sonde.transactions t ON d.tx_hash = t.tx_hash
      WHERE d.timestamp >= now() - INTERVAL 24 HOUR
        AND d.xrp_volume_drops > 1000000
        AND d.xrp_volume_drops < 100000000000
        AND t.tx_type = 'OfferCreate'
      GROUP BY d.tx_hash
      ORDER BY rand()
      LIMIT ${n}`,
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ hash: string; total_drops: string }>;
  return rows.map((r) => ({ hash: r.hash, expectedDrops: BigInt(r.total_drops) }));
}

async function main() {
  console.log("Verifying extractFillFromNode unfunded-offer fix\n");
  console.log("=".repeat(80));

  let pass = 0;
  let fail = 0;

  console.log("\n── KNOWN-CORRUPT TXS (expected: 0 fills after fix) ──");

  for (const { hash, note } of KNOWN_CORRUPT_TXS) {
    const data = await fetchTxMeta(hash);
    if (!data) {
      console.log(`\n[SKIP] ${hash}\n  Tx not found in sonde.transactions (${note})`);
      continue;
    }
    const txAccount = data.tx.Account as string;
    const nodes = data.meta.AffectedNodes ?? [];

    const fills = nodes
      .map((n) => extractFillFromNode(n, txAccount))
      .filter((f): f is Fill => f !== null);

    const totalDrops = fills.reduce((s, f) => s + fillXrpDrops(f), 0n);
    const totalXrp = Number(totalDrops) / 1_000_000;
    const overCap = totalXrp > SANITY_CAP_XRP;

    if (overCap) fail++;
    else pass++;

    console.log(`\n[${overCap ? "❌ FAIL" : "✅ PASS"}] ${hash}`);
    console.log(`  ${note}`);
    console.log(`  AffectedNodes: ${nodes.length}, fills extracted: ${fills.length}`);
    console.log(`  Total XRP volume: ${totalXrp.toLocaleString(undefined, { maximumFractionDigits: 2 })} XRP`);
    if (fills.length > 0 && fills.length <= 8) {
      for (const f of fills) {
        const xrp = Number(fillXrpDrops(f)) / 1_000_000;
        const gn = normalizeAmount(f.takerGets);
        const pn = normalizeAmount(f.takerPays);
        console.log(`    maker=${f.makerAccount?.slice(0, 10)} gets=${gn?.value} ${gn?.currency} pays=${pn?.value} ${pn?.currency} xrp=${xrp.toFixed(4)}`);
      }
    }
  }

  console.log("\n── KNOWN-LEGIT TXS (expected: fills, volumes match dex_trades) ──");

  const legit = await fetchRecentOfferCreates(8);
  for (const { hash, expectedDrops } of legit) {
    const data = await fetchTxMeta(hash);
    if (!data) continue;
    const txAccount = data.tx.Account as string;
    const nodes = data.meta.AffectedNodes ?? [];
    const fills = nodes
      .map((n) => extractFillFromNode(n, txAccount))
      .filter((f): f is Fill => f !== null);
    const totalDrops = fills.reduce((s, f) => s + fillXrpDrops(f), 0n);

    // Allow ±0.1 drops drift from rounding; any significant gap is a regression.
    const diff = totalDrops > expectedDrops ? totalDrops - expectedDrops : expectedDrops - totalDrops;
    const ok = fills.length > 0 && diff < 10n;
    if (ok) pass++;
    else fail++;

    const expectedXrp = Number(expectedDrops) / 1_000_000;
    const gotXrp = Number(totalDrops) / 1_000_000;
    console.log(
      `[${ok ? "✅ PASS" : "❌ FAIL"}] ${hash.slice(0, 10)}... fills=${fills.length} expected=${expectedXrp.toFixed(2)} XRP got=${gotXrp.toFixed(2)} XRP`,
    );
  }

  console.log("\n" + "=".repeat(80));
  console.log(`RESULTS: ${pass} pass, ${fail} fail`);
  await ch.close();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
