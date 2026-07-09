/**
 * Historical cleanup for the unfunded-offer-cleanup ingester bug
 * (fixed in c977ebb). Re-extracts every suspect tx through the
 * corrected extractor, deletes the polluted dex_trades rows, inserts
 * any legitimate fills the corrected extractor produces, and rebuilds
 * the affected MV buckets so downstream rankings reflect truth.
 *
 * Suspect predicate: any tx_hash where at least one dex_trades row has
 * xrp_volume_drops > 1e12 (1M XRP). The threshold is generous on
 * purpose — every confirmed-bad row in the audit was well above this,
 * and legitimate single fills above 1M XRP are vanishingly rare.
 *
 * The script is idempotent: re-running it after success is a no-op
 * (no rows match the suspect predicate any more). Run with --dry-run
 * to see what would change.
 *
 * Usage:
 *   pnpm exec tsx scripts/cleanup-unfunded-offer-rows.ts --dry-run
 *   pnpm exec tsx scripts/cleanup-unfunded-offer-rows.ts --apply
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@clickhouse/client";

const args = new Set(process.argv.slice(2));
const APPLY = args.has("--apply");
const DRY_RUN = !APPLY;

const SUSPECT_THRESHOLD_DROPS = 1_000_000_000_000n; // 1e12 = 1M XRP

const url = process.env.CLICKHOUSE_URL;
if (!url) {
  console.error("CLICKHOUSE_URL required");
  process.exit(1);
}
const ch = createClient({ url, database: "sonde", request_timeout: 120_000 });

// ── Inlined helpers (mirror src/lib/trade-extractors.ts at c977ebb).
//    Inlined because trade-extractors.ts has `import "server-only"` that
//    blocks tsx execution outside Next's runtime.

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
  return { mantissa: BigInt((sign || "") + intp + fracp), exp: parseInt(expp, 10) - fracp.length };
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

function addAmounts(a: string, b: string): string {
  const da = parseDecimalString(a);
  const db = parseDecimalString(b);
  if (!da || !db) return "0";
  let { mantissa: ma, exp: ea } = da;
  let { mantissa: mb, exp: eb } = db;
  if (ea > eb) { ma *= 10n ** BigInt(ea - eb); ea = eb; }
  else if (eb > ea) { mb *= 10n ** BigInt(eb - ea); eb = ea; }
  return formatDecimalString(ma + mb, ea);
}

function parseDropsSafe(s: string): bigint {
  try { return BigInt(s.includes(".") ? s.split(".")[0] : s); } catch { return 0n; }
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

/* AMM-fill extraction. Detects swaps via AccountRoot.AMMID and
 * reconstructs takerGets/takerPays from balance deltas on the AMM's
 * pseudo-account (XRP via AccountRoot.Balance, IOU via RippleState).
 * Mirrors src/lib/trade-extractors.ts extractAmmFillsFromTx. */
function extractAmmFillsFromTx(
  tx: { Account: string },
  meta: { AffectedNodes?: Array<Record<string, unknown>> },
): Fill[] {
  if (!meta?.AffectedNodes) return [];

  type AmmDelta = {
    xrpDelta: bigint;
    iouDeltas: Map<string, { currency: string; issuer: string; delta: string }>;
  };
  const ammByAddr = new Map<string, AmmDelta>();
  const ensureAmm = (addr: string): AmmDelta => {
    let d = ammByAddr.get(addr);
    if (!d) { d = { xrpDelta: 0n, iouDeltas: new Map() }; ammByAddr.set(addr, d); }
    return d;
  };

  // Pass 1: find AMM accounts by AccountRoot.AMMID + record XRP delta.
  for (const node of meta.AffectedNodes) {
    const modified = node.ModifiedNode as { LedgerEntryType?: string; FinalFields?: Record<string, unknown>; PreviousFields?: Record<string, unknown> } | undefined;
    if (modified?.LedgerEntryType !== "AccountRoot") continue;
    const final = modified.FinalFields;
    const prev = modified.PreviousFields;
    if (!final?.Account || !final?.AMMID) continue;
    const addr = final.Account as string;
    const finalBal = parseDropsSafe(String(final.Balance ?? "0"));
    const prevBal = prev?.Balance != null ? parseDropsSafe(String(prev.Balance)) : finalBal;
    ensureAmm(addr).xrpDelta = finalBal - prevBal;
  }

  if (ammByAddr.size === 0) return [];

  // Pass 2: collect IOU deltas from RippleState entries.
  for (const node of meta.AffectedNodes) {
    const modified = node.ModifiedNode as { LedgerEntryType?: string; FinalFields?: Record<string, unknown>; PreviousFields?: Record<string, unknown> } | undefined;
    if (modified?.LedgerEntryType !== "RippleState") continue;
    const final = modified.FinalFields;
    const prev = modified.PreviousFields;
    if (!final) continue;

    const finalBalance = final.Balance as { value?: string; currency?: string } | undefined;
    if (!finalBalance?.value || !finalBalance.currency) continue;
    const prevBalance = (prev?.Balance as { value?: string } | undefined)?.value ?? finalBalance.value;

    const lowAddr = (final.LowLimit as { issuer?: string } | undefined)?.issuer;
    const highAddr = (final.HighLimit as { issuer?: string } | undefined)?.issuer;
    const currency = finalBalance.currency;
    const balDelta = subtractAmounts(finalBalance.value, prevBalance); // signed

    if (lowAddr && ammByAddr.has(lowAddr)) {
      const issuer = highAddr ?? "";
      const key = `${currency}|${issuer}`;
      const d = ensureAmm(lowAddr);
      const ex = d.iouDeltas.get(key);
      d.iouDeltas.set(key, { currency, issuer, delta: ex ? addAmounts(ex.delta, balDelta) : balDelta });
    } else if (highAddr && ammByAddr.has(highAddr)) {
      // AMM is HighLimit → flip sign
      const ammDelta = balDelta.startsWith("-") ? balDelta.slice(1) : (balDelta === "0" ? "0" : "-" + balDelta);
      const issuer = lowAddr ?? "";
      const key = `${currency}|${issuer}`;
      const d = ensureAmm(highAddr);
      const ex = d.iouDeltas.get(key);
      d.iouDeltas.set(key, { currency, issuer, delta: ex ? addAmounts(ex.delta, ammDelta) : ammDelta });
    }
  }

  // Pass 3: emit one fill per AMM (one negative side, one positive side).
  const fills: Fill[] = [];
  for (const [addr, data] of ammByAddr) {
    type Side = { currency: string; issuer: string; deltaIsNegative: boolean; absValue: string };
    const sides: Side[] = [];
    if (data.xrpDelta !== 0n) {
      const negative = data.xrpDelta < 0n;
      sides.push({ currency: "XRP", issuer: "", deltaIsNegative: negative, absValue: (negative ? -data.xrpDelta : data.xrpDelta).toString() });
    }
    for (const { currency, issuer, delta } of data.iouDeltas.values()) {
      if (delta === "0") continue;
      const negative = delta.startsWith("-");
      sides.push({ currency, issuer, deltaIsNegative: negative, absValue: negative ? delta.slice(1) : delta });
    }
    const gave = sides.filter((s) => s.deltaIsNegative);
    const received = sides.filter((s) => !s.deltaIsNegative);
    if (gave.length !== 1 || received.length !== 1) continue;
    const sold = gave[0];
    const bought = received[0];
    const takerGets = sold.currency === "XRP" ? sold.absValue : { value: sold.absValue, currency: sold.currency, issuer: sold.issuer };
    const takerPays = bought.currency === "XRP" ? bought.absValue : { value: bought.absValue, currency: bought.currency, issuer: bought.issuer };
    fills.push({ takerGets, takerPays, makerAccount: addr });
  }
  // Suppress unused-var lint: txAccount kept for symmetry with offer-fill API
  void tx;
  return fills;
}

// ── Build a full dex_trades row from a Fill (mirrors intel-ingestion.ts:1173-1224)

interface DexTradeRow {
  tx_hash: string;
  fill_index: number;
  timestamp: string;
  ledger_index: number;
  taker: string;
  maker: string;
  base_currency: string;
  base_issuer: string;
  base_amount: number;
  base_amount_iou: string;
  quote_currency: string;
  quote_issuer: string;
  quote_amount: number;
  quote_amount_iou: string;
  price: number;
  xrp_volume_drops: string;
}

function buildDexTradeRow(
  fill: Fill,
  takerAccount: string,
  txHash: string,
  txTimestamp: string,
  txLedgerIndex: number,
  fillIdx: number,
): DexTradeRow | null {
  const gets = normalizeAmount(fill.takerGets);
  const pays = normalizeAmount(fill.takerPays);
  if (!gets || !pays) return null;
  if (gets.currency === "XRP" && pays.currency === "XRP") return null;

  const baseIsGets = gets.currency !== "XRP";
  const baseCurrency = baseIsGets ? gets.currency : pays.currency;
  const baseIssuer = baseIsGets ? (gets.issuer ?? "") : (pays.issuer ?? "");
  const baseValueStr = baseIsGets ? gets.value : pays.value;
  const baseAmount = Number(baseValueStr);
  const baseAmountIou = baseCurrency === "XRP" ? "" : baseValueStr;

  const quoteCurrency = baseIsGets ? pays.currency : gets.currency;
  const quoteIssuer = baseIsGets ? (pays.issuer ?? "") : (gets.issuer ?? "");
  const quoteValueStr = baseIsGets ? pays.value : gets.value;
  let quoteAmount = Number(quoteValueStr);
  if (quoteCurrency === "XRP") quoteAmount /= 1_000_000;
  const quoteAmountIou = quoteCurrency === "XRP" ? "" : quoteValueStr;
  const price = baseAmount > 0 ? quoteAmount / baseAmount : 0;

  let xrpVolumeDrops = 0n;
  if (gets.currency === "XRP") xrpVolumeDrops = parseDropsSafe(gets.value);
  else if (pays.currency === "XRP") xrpVolumeDrops = parseDropsSafe(pays.value);

  return {
    tx_hash: txHash,
    fill_index: fillIdx,
    timestamp: txTimestamp,
    ledger_index: txLedgerIndex,
    taker: takerAccount,
    maker: fill.makerAccount ?? "",
    base_currency: baseCurrency,
    base_issuer: baseIssuer,
    base_amount: baseAmount,
    base_amount_iou: baseAmountIou,
    quote_currency: quoteCurrency,
    quote_issuer: quoteIssuer,
    quote_amount: quoteAmount,
    quote_amount_iou: quoteAmountIou,
    price,
    xrp_volume_drops: xrpVolumeDrops.toString(),
  };
}

// ── Main flow ──

interface AffectedBuckets {
  walletHour: Set<string>; // "ISO_HOUR|wallet"
  pairDay: Set<string>;    // "YYYY-MM-DD|baseC|baseI|quoteC|quoteI"
  tokenHour: Set<string>;  // "ISO_HOUR|baseC|baseI|quoteC|quoteI"
}

function startOfHour(timestamp: string): string {
  // Input format: "YYYY-MM-DD HH:MM:SS"
  return timestamp.slice(0, 13) + ":00:00";
}

function dayOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (will mutate prod)" : "DRY RUN"}\n`);

  // Step 1: identify suspect tx_hashes
  console.log(`[1/5] Finding suspect tx_hashes (any row with xrp_volume_drops > ${SUSPECT_THRESHOLD_DROPS / 1_000_000n}M XRP)...`);
  const suspectsRes = await ch.query({
    query: `
      SELECT DISTINCT tx_hash
      FROM dex_trades
      WHERE xrp_volume_drops > ${SUSPECT_THRESHOLD_DROPS}`,
    format: "JSONEachRow",
  });
  const suspectRows = (await suspectsRes.json()) as Array<{ tx_hash: string }>;
  const suspectHashes = suspectRows.map((r) => r.tx_hash);
  console.log(`      → ${suspectHashes.length} suspect tx_hashes\n`);

  if (suspectHashes.length === 0) {
    console.log("Nothing to clean. Exiting.");
    await ch.close();
    return;
  }

  // Step 2: fetch ALL dex_trades rows for those tx_hashes (need full bucket
  // keys, not just the suspect rows — every row contributes to MV buckets)
  console.log("[2/5] Fetching all dex_trades rows for suspect txs...");
  const inList = suspectHashes.map((h) => `'${h}'`).join(",");
  const allRowsRes = await ch.query({
    query: `
      SELECT tx_hash, taker, maker, base_currency, base_issuer, quote_currency, quote_issuer,
             toString(timestamp) AS timestamp, xrp_volume_drops
      FROM dex_trades
      WHERE tx_hash IN (${inList})`,
    format: "JSONEachRow",
  });
  const allRows = (await allRowsRes.json()) as Array<{
    tx_hash: string;
    taker: string;
    maker: string;
    base_currency: string;
    base_issuer: string;
    quote_currency: string;
    quote_issuer: string;
    timestamp: string;
    xrp_volume_drops: string;
  }>;
  console.log(`      → ${allRows.length} dex_trades rows associated with suspect txs\n`);

  // Compute affected MV buckets
  const buckets: AffectedBuckets = {
    walletHour: new Set(),
    pairDay: new Set(),
    tokenHour: new Set(),
  };
  for (const r of allRows) {
    const hour = startOfHour(r.timestamp);
    const day = dayOf(r.timestamp);
    if (r.taker) buckets.walletHour.add(`${hour}|${r.taker}`);
    if (r.maker) buckets.walletHour.add(`${hour}|${r.maker}`);
    buckets.pairDay.add(`${day}|${r.base_currency}|${r.base_issuer}|${r.quote_currency}|${r.quote_issuer}`);
    buckets.tokenHour.add(`${hour}|${r.base_currency}|${r.base_issuer}|${r.quote_currency}|${r.quote_issuer}`);
  }
  console.log(
    `      → buckets affected: ${buckets.walletHour.size} wallet/hour, ${buckets.pairDay.size} pair/day, ${buckets.tokenHour.size} token/hour\n`,
  );

  // Step 3: re-extract each suspect tx through the fixed extractor
  console.log("[3/5] Re-extracting suspect txs through fixed extractor (offer + AMM paths)...");
  const correctedRows: DexTradeRow[] = [];
  let recoveredOfferFills = 0;
  let recoveredAmmFills = 0;
  let zeroFillTxs = 0;
  for (const hash of suspectHashes) {
    const txRes = await ch.query({
      query: `SELECT tx_json, meta_json, toString(timestamp) AS ts, ledger_index FROM transactions WHERE tx_hash = '${hash}' LIMIT 1`,
      format: "JSONEachRow",
    });
    const txRows = (await txRes.json()) as Array<{ tx_json: string; meta_json: string; ts: string; ledger_index: number }>;
    if (!txRows[0]) {
      console.log(`      [WARN] No raw tx in sonde.transactions for ${hash} — will only delete, no replacement`);
      continue;
    }
    const tx = JSON.parse(txRows[0].tx_json) as { Account: string; TransactionType: string };
    const meta = JSON.parse(txRows[0].meta_json) as { AffectedNodes?: Array<Record<string, unknown>> };
    if (tx.TransactionType !== "OfferCreate" && tx.TransactionType !== "Payment") {
      zeroFillTxs++;
      continue;
    }
    const nodes = meta.AffectedNodes ?? [];
    const offerFills = nodes.map((n) => extractFillFromNode(n, tx.Account)).filter((f): f is Fill => f !== null);
    const ammFills = extractAmmFillsFromTx(tx, meta);
    const allFills = [...offerFills, ...ammFills];
    if (allFills.length === 0) {
      zeroFillTxs++;
      continue;
    }
    recoveredOfferFills += offerFills.length;
    recoveredAmmFills += ammFills.length;
    // Build dex_trades rows preserving original fill_index ordering
    // (offer fills first, then AMM fills, matching intel-ingestion.ts).
    for (let i = 0; i < allFills.length; i++) {
      const row = buildDexTradeRow(allFills[i], tx.Account, hash, txRows[0].ts, txRows[0].ledger_index, i);
      if (row) correctedRows.push(row);
    }
  }
  console.log(
    `      → ${zeroFillTxs}/${suspectHashes.length} suspect txs produce 0 fills with the fix (full delete)`,
  );
  console.log(`      → ${recoveredOfferFills} legit offer fills recovered`);
  console.log(`      → ${recoveredAmmFills} legit AMM fills recovered`);
  console.log(`      → ${correctedRows.length} replacement dex_trades rows queued\n`);

  if (DRY_RUN) {
    console.log("[DRY RUN] Stopping here. Re-run with --apply to mutate prod.");
    await ch.close();
    return;
  }

  // Step 4a: DELETE suspect rows from dex_trades
  console.log("[4/5] Deleting suspect rows from dex_trades...");
  await ch.command({
    query: `ALTER TABLE dex_trades DELETE WHERE tx_hash IN (${inList}) SETTINGS mutations_sync = 2`,
  });
  console.log(`      → deleted (mutation synced)`);

  // Step 4b: INSERT replacement rows. Done as a JSONEachRow batch so
  // the MV trigger views fire and auto-update mv_wallet_trade_volume_hourly,
  // mv_dex_pair_daily, mv_token_volume_hourly.
  if (correctedRows.length > 0) {
    console.log(`      → inserting ${correctedRows.length} corrected rows...`);
    await ch.insert({
      table: "dex_trades",
      values: correctedRows,
      format: "JSONEachRow",
    });
    console.log(`      → inserted\n`);
  } else {
    console.log(`      → no replacement rows to insert\n`);
  }

  // Step 5: rebuild affected MV buckets
  // The trigger views above already populated MVs from the new INSERTs,
  // but those are ADDITIVE — the still-polluted aggregate rows for the
  // old (deleted) suspect rows are still there. We need to clear and
  // re-aggregate each affected bucket from clean dex_trades.
  console.log("[5/5] Rebuilding affected MV buckets...");
  let bucketCount = 0;

  // 5a. mv_wallet_trade_volume_hourly
  for (const key of buckets.walletHour) {
    const [hour, wallet] = key.split("|");
    if (!wallet) continue;
    await ch.command({
      query: `
        ALTER TABLE mv_wallet_trade_volume_hourly DELETE
        WHERE hour = toDateTime('${hour}') AND wallet = '${wallet}'
        SETTINGS mutations_sync = 2`,
    });
    // Re-aggregate (taker side)
    await ch.command({
      query: `
        INSERT INTO mv_wallet_trade_volume_hourly
        SELECT toStartOfHour(timestamp) AS hour, taker AS wallet,
               count() AS trade_count, sum(xrp_volume_drops) AS xrp_volume_drops
        FROM dex_trades
        WHERE timestamp >= toDateTime('${hour}')
          AND timestamp < addHours(toDateTime('${hour}'), 1)
          AND taker = '${wallet}' AND taker != ''
        GROUP BY hour, wallet`,
    });
    // Re-aggregate (maker side)
    await ch.command({
      query: `
        INSERT INTO mv_wallet_trade_volume_hourly
        SELECT toStartOfHour(timestamp) AS hour, maker AS wallet,
               count() AS trade_count, sum(xrp_volume_drops) AS xrp_volume_drops
        FROM dex_trades
        WHERE timestamp >= toDateTime('${hour}')
          AND timestamp < addHours(toDateTime('${hour}'), 1)
          AND maker = '${wallet}' AND maker != ''
        GROUP BY hour, wallet`,
    });
    bucketCount++;
    if (bucketCount % 25 === 0) console.log(`      ... ${bucketCount}/${buckets.walletHour.size} wallet/hour buckets`);
  }
  console.log(`      → ${buckets.walletHour.size} wallet/hour buckets rebuilt`);

  // 5b. mv_dex_pair_daily
  bucketCount = 0;
  for (const key of buckets.pairDay) {
    const [day, baseC, baseI, quoteC, quoteI] = key.split("|");
    await ch.command({
      query: `
        ALTER TABLE mv_dex_pair_daily DELETE
        WHERE day = toDate('${day}')
          AND base_currency = '${baseC}'
          AND base_issuer = '${baseI}'
          AND quote_currency = '${quoteC}'
          AND quote_issuer = '${quoteI}'
        SETTINGS mutations_sync = 2`,
    });
    await ch.command({
      query: `
        INSERT INTO mv_dex_pair_daily
        SELECT toDate(timestamp) AS day, base_currency, base_issuer, quote_currency, quote_issuer,
               count() AS trade_count, sum(base_amount) AS base_volume,
               sum(quote_amount) AS quote_volume, sum(xrp_volume_drops) AS xrp_volume_drops
        FROM dex_trades
        WHERE timestamp >= toDateTime('${day} 00:00:00')
          AND timestamp < toDateTime('${day} 00:00:00') + INTERVAL 1 DAY
          AND base_currency = '${baseC}'
          AND base_issuer = '${baseI}'
          AND quote_currency = '${quoteC}'
          AND quote_issuer = '${quoteI}'
        GROUP BY day, base_currency, base_issuer, quote_currency, quote_issuer`,
    });
    bucketCount++;
  }
  console.log(`      → ${buckets.pairDay.size} pair/day buckets rebuilt`);

  // 5c. mv_token_volume_hourly (with OHLC state columns)
  bucketCount = 0;
  for (const key of buckets.tokenHour) {
    const [hour, baseC, baseI, quoteC, quoteI] = key.split("|");
    await ch.command({
      query: `
        ALTER TABLE mv_token_volume_hourly DELETE
        WHERE hour = toDateTime('${hour}')
          AND base_currency = '${baseC}'
          AND base_issuer = '${baseI}'
          AND quote_currency = '${quoteC}'
          AND quote_issuer = '${quoteI}'
        SETTINGS mutations_sync = 2`,
    });
    await ch.command({
      query: `
        INSERT INTO mv_token_volume_hourly
        SELECT toStartOfHour(timestamp) AS hour, base_currency, base_issuer, quote_currency, quote_issuer,
               count() AS trade_count, sum(base_amount) AS base_volume,
               sum(quote_amount) AS quote_volume, sum(xrp_volume_drops) AS xrp_volume_drops,
               argMinState(price, timestamp) AS open_price,
               argMaxState(price, timestamp) AS close_price,
               max(price) AS high_price, min(price) AS low_price
        FROM dex_trades
        WHERE timestamp >= toDateTime('${hour}')
          AND timestamp < addHours(toDateTime('${hour}'), 1)
          AND base_currency = '${baseC}'
          AND base_issuer = '${baseI}'
          AND quote_currency = '${quoteC}'
          AND quote_issuer = '${quoteI}'
        GROUP BY hour, base_currency, base_issuer, quote_currency, quote_issuer`,
    });
    bucketCount++;
  }
  console.log(`      → ${buckets.tokenHour.size} token/hour buckets rebuilt\n`);

  // Final verification
  console.log("Final verification:");
  const verifyRes = await ch.query({
    query: `SELECT count() AS rows, max(xrp_volume_drops) AS max_drops FROM dex_trades WHERE xrp_volume_drops > ${SUSPECT_THRESHOLD_DROPS}`,
    format: "JSONEachRow",
  });
  const verify = (await verifyRes.json()) as Array<{ rows: string; max_drops: string }>;
  console.log(`  dex_trades rows still > ${SUSPECT_THRESHOLD_DROPS / 1_000_000n}M XRP: ${verify[0].rows} (max=${verify[0].max_drops})`);

  await ch.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
