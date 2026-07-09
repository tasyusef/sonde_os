/**
 * IngestionManager — subscribes directly to the XRPL ledger stream,
 * fetches expanded ledger data, extracts trades, and persists volume
 * aggregations to Postgres.
 *
 * Runs independently of the LiveDataManager / SSE system.
 * Controlled by the ENABLE_INGESTION env var.
 *
 * Architecture: aggregation-only — we store volume aggregations,
 * NOT raw transactions, trades, or full ledger data. A lightweight
 * `ingested_ledgers` table tracks which ledgers have been processed
 * (for dedup + gap detection).
 */

import "server-only";
import logger from "./logger";
import { sql } from "drizzle-orm";

const log = logger.child({ module: "ingestion" });
import { db } from "@/db";
import {
  ingestedLedgers,
  ingestionState,
  marketplaceRegistry,
  tokenMetadata,
  ammPools,
  trackedAccounts,
  tokenCostBasis,
  tokenRealizedPnl,
} from "@/db/schema";
import { XrplClient } from "./xrpl-client";
import { extractNFTTrade, extractTokenTrades } from "./trade-extractors";
import { recordKnownURI } from "./nft-metadata-resolver";
import { extractCostBasisEvents, extractDisposalEvents, extractXrpCostBasisEvents, extractXrpDisposalEvents } from "./cost-basis-extractor";
import { getXrpPrice } from "./price-data";
import { queueTokenIconResolve } from "./token-icon-resolver";
import type { ExpandedLedger, RawLedgerTx } from "@/types/ingestion";
import type { CostBasisEvent, DisposalEvent } from "./cost-basis-extractor";
import { XRPL_EPOCH } from "./xrpl-helpers";

/** Gap detection interval: 5 minutes */
const GAP_CHECK_INTERVAL = 5 * 60 * 1000;

/** Marketplace registry reload interval: 1 hour */
const REGISTRY_RELOAD_INTERVAL = 60 * 60 * 1000;

/** Tracked accounts reload interval: 1 minute (new sign-ins detected quickly) */
const TRACKED_ACCOUNTS_RELOAD_INTERVAL = 60 * 1000;

/** Max gap-fill ledgers per cycle (rate-limit safe) */
const MAX_GAP_FILL_PER_CYCLE = 50;

/* ------------------------------------------------------------------ */
/*  Manager class                                                      */
/* ------------------------------------------------------------------ */

class IngestionManager {
  private running = false;
  /** Serialises ledger processing — only one runs at a time. */
  private processingChain: Promise<void> = Promise.resolve();
  private processing = false;
  private unsubscribe: (() => void) | null = null;
  private gapInterval: ReturnType<typeof setInterval> | null = null;
  private registryInterval: ReturnType<typeof setInterval> | null = null;
  private marketplaceMap = new Map<string, string>();
  private trackedAccountSet = new Set<string>();
  private trackedAccountInterval: ReturnType<typeof setInterval> | null = null;
  private startedAt: Date | null = null;

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.startedAt = new Date();
    log.info("Starting pipeline");

    // Load marketplace registry + tracked accounts into memory
    await this.loadMarketplaceRegistry();
    await this.loadTrackedAccounts();

    // Update pipeline status
    await this.upsertState("pipeline_status", "running");

    try {
      this.unsubscribe = await getIngestionClient().subscribeLedger((raw: unknown) => {
        const ledgerIndex = this.parseLedgerIndex(raw);
        if (!ledgerIndex) return;
        // Skip if already processing — we'll catch gaps via gap-fill.
        // Chain ensures only one ingestLedger runs at a time.
        if (this.processing) return;
        this.processing = true;
        this.processingChain = this.processingChain
          .then(() => this.ingestLedger(ledgerIndex))
          .catch((err) =>
            log.error({ err, ledgerIndex }, "Ledger processing error"),
          )
          .finally(() => {
            this.processing = false;
          });
      });
    } catch (err) {
      log.error({ err }, "Failed to subscribe");
      this.running = false;
      await this.upsertState("pipeline_status", "error");
      return;
    }

    // Start gap detection on interval
    this.gapInterval = setInterval(
      () => this.detectAndFillGaps().catch((err) => log.error({ err }, "Gap detection failed")),
      GAP_CHECK_INTERVAL,
    );

    // Reload marketplace registry hourly so new seed entries take effect
    this.registryInterval = setInterval(
      () => this.loadMarketplaceRegistry().catch((err) => log.error({ err }, "Marketplace registry load failed")),
      REGISTRY_RELOAD_INTERVAL,
    );

    // Reload tracked accounts every minute to pick up new wallet sign-ins
    this.trackedAccountInterval = setInterval(
      () => this.loadTrackedAccounts().catch((err) => log.error({ err }, "Tracked accounts load failed")),
      TRACKED_ACCOUNTS_RELOAD_INTERVAL,
    );

    log.info("Pipeline started — listening for ledger closes");
  }

  async stop(): Promise<void> {
    log.info("Stopping pipeline");
    this.running = false;

    this.unsubscribe?.();
    this.unsubscribe = null;

    for (const key of ["gapInterval", "registryInterval", "trackedAccountInterval"] as const) {
      clearInterval(this[key]!);
      this[key] = null;
    }

    await this.upsertState("pipeline_status", "stopped");
  }

  async getStatus(): Promise<{
    status: string;
    latestLedger: number;
    earliestLedger: number;
    totalLedgers: number;
    startedAt: string | null;
  }> {
    const [statusRow] = await db
      .select()
      .from(ingestionState)
      .where(sql`${ingestionState.key} = 'pipeline_status'`);
    const [latestRow] = await db
      .select()
      .from(ingestionState)
      .where(sql`${ingestionState.key} = 'latest_ledger'`);
    const [earliestRow] = await db
      .select()
      .from(ingestionState)
      .where(sql`${ingestionState.key} = 'earliest_ledger'`);

    const [ledgerCount] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(ingestedLedgers);

    return {
      status: statusRow?.value ?? "stopped",
      latestLedger: Number(latestRow?.value ?? 0),
      earliestLedger: Number(earliestRow?.value ?? 0),
      totalLedgers: ledgerCount?.count ?? 0,
      startedAt: this.startedAt?.toISOString() ?? null,
    };
  }

  /* ---------- Core ingestion ---------- */

  private async ingestLedger(ledgerIndex: number): Promise<void> {
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.ingestLedgerAttempt(ledgerIndex);
        return;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        const isDeadlock = msg.includes("deadlock detected");
        if (isDeadlock && attempt < MAX_RETRIES) {
          log.warn({ ledgerIndex, attempt }, "Deadlock detected, retrying");
          // Brief backoff before retry: 100ms, 200ms
          await new Promise((r) => setTimeout(r, attempt * 100));
          continue;
        }
        throw err;
      }
    }
  }

  private async ingestLedgerAttempt(ledgerIndex: number): Promise<void> {
    // Check if already ingested
    const [existing] = await db
      .select({ ledgerIndex: ingestedLedgers.ledgerIndex })
      .from(ingestedLedgers)
      .where(sql`${ingestedLedgers.ledgerIndex} = ${ledgerIndex}`)
      .limit(1);

    if (existing) return;

    // Fetch expanded ledger
    const result = (await getIngestionClient().getLedger(
      ledgerIndex,
      true,
    )) as ExpandedLedger;

    const ledger = result.ledger;
    if (ledger.close_time == null || ledger.ledger_index == null) {
      log.warn({ ledgerIndex }, "Ledger missing close_time or ledger_index, skipping");
      return;
    }
    const txs = (ledger.transactions ?? []) as RawLedgerTx[];

    let nftTradeCount = 0;
    let tokenTradeCount = 0;
    let costBasisEventCount = 0;

    // Fetch XRP/USD price for cost basis USD calculations (cached, no extra API call)
    let xrpPriceUsd = 0;
    if (this.trackedAccountSet.size > 0) {
      try {
        const priceData = await getXrpPrice();
        xrpPriceUsd = priceData.price;
      } catch {
        // Non-fatal — cost basis USD will be 0 for this ledger
      }
    }

    // Accumulators for batch upserts
    const costBasisMap = new Map<string, CostBasisEvent>();
    const disposalEvents: DisposalEvent[] = [];
    const newTokenPairs = new Set<string>(); // "currency|issuer" for batch auto-registration
    const recentTradeRows: { txHash: string; nftokenId: string; buyer: string; seller: string; amountDrops: bigint | null; date: number | null; ledgerIndex: number }[] = [];
    // URI captures collected during the loop. Mint captures come with the URI
    // inline (from the tx itself). Trade captures need an nft_info lookup
    // after the transaction commits. Both flow into the nft_metadata cache.
    const mintURIs: Array<{ nftokenId: string; uri: string }> = [];
    const tradeNftIds: string[] = [];

    // Atomic transaction via Drizzle ORM
    await db.transaction(async (tx) => {
      // Process transactions — extract trades and update volumes
      for (let i = 0; i < txs.length; i++) {
        // Shallow-copy so we can stamp date/ledger_index without mutating
        // the cached ledger object (shared with intel-ingestion via cache).
        const rawTx = { ...txs[i] };

        // Expanded ledger responses don't include `date` or `ledger_index` on
        // individual transactions — stamp from the ledger so extractors
        // compute correct dates and ledger references.
        if (rawTx.date == null) rawTx.date = ledger.close_time;
        if (rawTx.ledger_index == null) rawTx.ledger_index = ledger.ledger_index;

        const meta = rawTx.meta ?? rawTx.metaData;
        const txResult = meta?.TransactionResult ?? "";
        const isSuccess = txResult === "tesSUCCESS";

        const txDate = rawTx.date ?? ledger.close_time;
        const txDateIso = new Date((txDate + XRPL_EPOCH) * 1000);

        if (!isSuccess) continue;

        // Extract NFT trade → accumulate for recent trades + URI capture
        const nftTrade = extractNFTTrade(rawTx, this.marketplaceMap);
        if (nftTrade) {
          nftTradeCount++;

          // Accumulate for recent trades rolling buffer
          recentTradeRows.push({
            txHash: nftTrade.txHash,
            nftokenId: nftTrade.nftId,
            buyer: nftTrade.buyer,
            seller: nftTrade.seller,
            amountDrops: nftTrade.isXrp && nftTrade.amountDrops != null ? nftTrade.amountDrops : null,
            date: nftTrade.date,
            ledgerIndex: ledger.ledger_index,
          });

          // Queue URI capture: we don't get URI from the trade tx itself,
          // so an nft_info lookup will run after the transaction commits.
          tradeNftIds.push(nftTrade.nftId);
        }

        // NFTokenMint: URI is inline on the tx, so capture directly. We rely
        // on the convenience `nftoken_id` meta field (modern rippled / Clio).
        // If it's missing we skip — a subsequent trade will trigger the
        // nft_info fallback.
        if (
          isSuccess &&
          rawTx.TransactionType === "NFTokenMint" &&
          typeof rawTx.URI === "string" &&
          rawTx.URI.length > 0 &&
          meta?.nftoken_id
        ) {
          mintURIs.push({ nftokenId: meta.nftoken_id, uri: rawTx.URI });
        }

        // Extract token trades for token metadata auto-registration
        const fills = extractTokenTrades(rawTx);
        for (const fill of fills) {
          if (fill.isXrpPair && fill.xrpVolumeDrops != null) {
            const currency =
              fill.takerGetsCurrency === "XRP"
                ? fill.takerPaysCurrency
                : fill.takerGetsCurrency;
            const issuer =
              fill.takerGetsCurrency === "XRP"
                ? (fill.takerPaysIssuer ?? "")
                : (fill.takerGetsIssuer ?? "");

            newTokenPairs.add(`${currency}|${issuer}`);
          }

          tokenTradeCount++;
        }

        // Detect AMMCreate → register new AMM pool
        if (rawTx.TransactionType === "AMMCreate") {
          const ammAccount = findCreatedAMMAccount(meta?.AffectedNodes ?? []);
          if (ammAccount) {
            const assets = parseAMMCreateAssets(rawTx);
            if (assets) {
              await tx
                .insert(ammPools)
                .values({
                  account: ammAccount,
                  asset1Currency: assets.asset1Currency,
                  asset1Issuer: assets.asset1Issuer,
                  asset2Currency: assets.asset2Currency,
                  asset2Issuer: assets.asset2Issuer,
                  tradingFee: assets.tradingFee,
                })
                .onConflictDoNothing();
            }
          }
        }

        // Detect AMMDelete → remove AMM pool
        if (rawTx.TransactionType === "AMMDelete") {
          const deletedAccount = findDeletedAMMAccount(meta?.AffectedNodes ?? []);
          if (deletedAccount) {
            await tx
              .delete(ammPools)
              .where(sql`${ammPools.account} = ${deletedAccount}`);
          }
        }

        // Detect AMMVote → update pool's trading fee
        if (rawTx.TransactionType === "AMMVote") {
          const feeUpdate = findAMMVoteFeeUpdate(meta?.AffectedNodes ?? []);
          if (feeUpdate) {
            await tx
              .update(ammPools)
              .set({ tradingFee: feeUpdate.tradingFee })
              .where(sql`${ammPools.account} = ${feeUpdate.account}`);
          }
        }

        // F. Cost basis for tracked accounts
        if (this.trackedAccountSet.size > 0) {
          const cbEvents = extractCostBasisEvents(
            rawTx,
            meta?.AffectedNodes ?? [],
            this.trackedAccountSet,
            xrpPriceUsd,
          );
          for (const evt of cbEvents) {
            const cbKey = `${evt.address}|${evt.currency}|${evt.issuer}`;
            const existing = costBasisMap.get(cbKey);
            if (existing) {
              existing.qtyIncrease = (
                parseFloat(existing.qtyIncrease) + parseFloat(evt.qtyIncrease)
              ).toString();
              existing.costDrops += evt.costDrops;
              existing.costUsd = (
                parseFloat(existing.costUsd) + parseFloat(evt.costUsd)
              ).toFixed(8);
            } else {
              costBasisMap.set(cbKey, { ...evt });
            }
            costBasisEventCount++;
          }

          // G. Disposal (sale) events for realized PnL
          const dEvents = extractDisposalEvents(
            rawTx,
            meta?.AffectedNodes ?? [],
            this.trackedAccountSet,
            xrpPriceUsd,
            ledger.ledger_index,
            txDateIso,
          );
          disposalEvents.push(...dEvents);

          // H. XRP cost basis from DEX trades (Offer-node approach — no AccountRoot noise)
          const xrpCbEvents = extractXrpCostBasisEvents(
            rawTx,
            meta?.AffectedNodes ?? [],
            this.trackedAccountSet,
            xrpPriceUsd,
          );
          for (const evt of xrpCbEvents) {
            const cbKey = `${evt.address}|${evt.currency}|${evt.issuer}`;
            const existing = costBasisMap.get(cbKey);
            if (existing) {
              existing.qtyIncrease = (
                parseFloat(existing.qtyIncrease) + parseFloat(evt.qtyIncrease)
              ).toString();
              existing.costDrops += evt.costDrops;
              existing.costUsd = (
                parseFloat(existing.costUsd) + parseFloat(evt.costUsd)
              ).toFixed(8);
            } else {
              costBasisMap.set(cbKey, { ...evt });
            }
            costBasisEventCount++;
          }

          const xrpDEvents = extractXrpDisposalEvents(
            rawTx,
            meta?.AffectedNodes ?? [],
            this.trackedAccountSet,
            xrpPriceUsd,
            ledger.ledger_index,
            txDateIso,
          );
          disposalEvents.push(...xrpDEvents);
        }
      }

      // PG `nft_volume_hourly` writer was here pre-2026-05-09. CH MV `mv_nft_volume_hourly` is the source now.
      // PG `token_volume_hourly` writer was here pre-2026-05-09. CH MV `mv_token_volume_hourly` is the source now.

      // Batch auto-register new tokens in metadata table
      for (const pair of newTokenPairs) {
        const [currency, issuer] = pair.split("|");
        await tx
          .insert(tokenMetadata)
          .values({ currency, issuer })
          .onConflictDoNothing();
      }

      // PG `fee_burn_hourly` writer was here pre-2026-05-09. CH MV `mv_fee_burn_hourly` is the source now.
      // PG `tx_count_hourly` writer was here pre-2026-05-09. CH MV `mv_tx_count_hourly` is the source now.
      // PG `payment_corridor_hourly` writer was here pre-2026-05-09. CH MV `mv_payment_corridor_hourly` is the source now.
      // PG `wallet_trade_volume_hourly` writer was here pre-2026-05-09. CH MV `mv_wallet_trade_volume_hourly` is the source now.

      // Batch upsert: cost basis
      for (const [, data] of costBasisMap) {
        await tx
          .insert(tokenCostBasis)
          .values({
            address: data.address,
            currency: data.currency,
            issuer: data.issuer,
            totalQtyAcquired: data.qtyIncrease,
            totalCostDrops: data.costDrops.toString(),
            totalCostUsd: data.costUsd,
          })
          .onConflictDoUpdate({
            target: [tokenCostBasis.address, tokenCostBasis.currency, tokenCostBasis.issuer],
            set: {
              totalQtyAcquired: sql`${tokenCostBasis.totalQtyAcquired}::numeric + ${data.qtyIncrease}::numeric`,
              totalCostDrops: sql`${tokenCostBasis.totalCostDrops}::numeric + ${BigInt(data.costDrops)}`,
              totalCostUsd: sql`${tokenCostBasis.totalCostUsd}::numeric + ${data.costUsd}::numeric`,
              updatedAt: new Date(),
            },
          });
      }

      // Batch insert: realized PnL from disposals
      for (const d of disposalEvents) {
        // Look up current WAVG cost from DB to compute realized PnL
        const costRows = await tx
          .select({
            totalQtyAcquired: tokenCostBasis.totalQtyAcquired,
            totalCostUsd: tokenCostBasis.totalCostUsd,
            totalCostDrops: tokenCostBasis.totalCostDrops,
          })
          .from(tokenCostBasis)
          .where(
            sql`${tokenCostBasis.address} = ${d.address}
              AND ${tokenCostBasis.currency} = ${d.currency}
              AND ${tokenCostBasis.issuer} = ${d.issuer}`,
          )
          .limit(1);

        const costRow = costRows[0];
        const qty = parseFloat(d.qtySold);
        let costBasisUsd = 0;
        let costBasisDrops = 0n;

        if (costRow) {
          const totalQty = parseFloat(costRow.totalQtyAcquired ?? "0");
          const totalCost = parseFloat(costRow.totalCostUsd ?? "0");
          let totalDrops = 0n;
          try { totalDrops = BigInt(costRow.totalCostDrops ?? "0"); } catch { /* non-integer */ }

          if (totalQty > 0) {
            // Weighted average cost per unit
            const avgCostUsd = totalCost / totalQty;
            costBasisUsd = qty * avgCostUsd;
            // Use Number for the division to avoid BigInt truncation compounding
            const avgCostDropsPerUnit = Number(totalDrops) / totalQty;
            costBasisDrops = BigInt(Math.round(qty * avgCostDropsPerUnit));
          }
        }

        const proceedsUsd = parseFloat(d.proceedsUsd);
        const pnlUsd = proceedsUsd - costBasisUsd;

        // Insert realized PnL record (onConflictDoNothing for idempotent reprocessing)
        await tx.insert(tokenRealizedPnl).values({
          address: d.address,
          currency: d.currency,
          issuer: d.issuer,
          qtySold: d.qtySold,
          costBasisUsd: costBasisUsd.toFixed(8),
          proceedsUsd: d.proceedsUsd,
          pnlUsd: pnlUsd.toFixed(8),
          txHash: d.txHash,
          ledgerIndex: d.ledgerIndex,
          realizedAt: d.timestamp,
        }).onConflictDoNothing();

        // Reduce cost basis running totals
        if (costRow) {
          await tx
            .update(tokenCostBasis)
            .set({
              totalQtyAcquired: sql`GREATEST(${tokenCostBasis.totalQtyAcquired}::numeric - ${d.qtySold}::numeric, 0)`,
              totalCostDrops: sql`GREATEST(${tokenCostBasis.totalCostDrops}::numeric - ${costBasisDrops.toString()}::numeric, 0)`,
              totalCostUsd: sql`GREATEST(${tokenCostBasis.totalCostUsd}::numeric - ${costBasisUsd.toFixed(8)}::numeric, 0)`,
              updatedAt: new Date(),
            })
            .where(
              sql`${tokenCostBasis.address} = ${d.address}
                AND ${tokenCostBasis.currency} = ${d.currency}
                AND ${tokenCostBasis.issuer} = ${d.issuer}`,
            );
        }
      }

      // PG recent_nft_trades rolling buffer was here pre-2026-05-09.
      // CH `nft_trades` is the only consumer now — the homepage
      // recent-trades feed reads from there directly via
      // `getRecentNftTrades` in `lib/db-queries.ts`. PG table dropped
      // in Phase 5 of the PG → CH migration.

      // Mark ledger as ingested
      await tx
        .insert(ingestedLedgers)
        .values({ ledgerIndex: ledger.ledger_index })
        .onConflictDoNothing();

      // Update ingestion state — latest and earliest ledger
      const ledgerStr = ledger.ledger_index.toString();

      await tx
        .insert(ingestionState)
        .values({ key: "latest_ledger", value: ledgerStr })
        .onConflictDoUpdate({
          target: ingestionState.key,
          set: {
            value: sql`GREATEST(${ingestionState.value}::int, ${ledger.ledger_index})::text`,
            updatedAt: new Date(),
          },
        });

      await tx
        .insert(ingestionState)
        .values({ key: "earliest_ledger", value: ledgerStr })
        .onConflictDoUpdate({
          target: ingestionState.key,
          set: {
            value: sql`CASE WHEN ${ingestionState.value} = '0' THEN ${ledgerStr} ELSE LEAST(${ingestionState.value}::int, ${ledger.ledger_index})::text END`,
            updatedAt: new Date(),
          },
        });
    });

    log.info({ ledgerIndex, txs: txs.length, nftTrades: nftTradeCount, tokenTrades: tokenTradeCount, costBasis: costBasisEventCount }, "Ledger ingested");

    // Post-commit NFT URI capture (fire-and-forget — never blocks ingestion).
    // Mint URIs are captured inline; trade URIs need an nft_info lookup
    // per unique NFTokenID.
    if (mintURIs.length > 0 || tradeNftIds.length > 0) {
      this.captureNFTUris(mintURIs, tradeNftIds).catch((err) => {
        log.warn({ err, ledgerIndex }, "NFT URI capture failed");
      });
    }

    // Post-commit XLS-26 icon resolve for every token pair this ledger
    // touched. The resolver internally dedupes recent attempts, so passing
    // the full set each ledger is cheap — new tokens queue, seen-recently
    // pairs no-op. Worker pool caps concurrency; writes only when icon IS NULL.
    if (newTokenPairs.size > 0) {
      for (const pair of newTokenPairs) {
        const [currency, issuer] = pair.split("|");
        queueTokenIconResolve(currency, issuer);
      }
    }
  }

  /* ---------- NFT URI capture ---------- */

  /**
   * Populate the nft_metadata cache with URIs discovered during ingestion.
   * Mint URIs are written directly (URI is inline on the mint tx). Trade
   * URIs require an nft_info lookup since NFTokenAcceptOffer doesn't carry
   * the URI. Runs fire-and-forget — never blocks the ingestion loop.
   */
  private async captureNFTUris(
    mintURIs: Array<{ nftokenId: string; uri: string }>,
    tradeNftIds: string[],
  ): Promise<void> {
    // Write mint URIs directly — no XRPL call needed.
    await Promise.allSettled(
      mintURIs.map(({ nftokenId, uri }) => recordKnownURI(nftokenId, uri)),
    );

    // Fetch trade URIs via nft_info. Skip any we just learned from mints
    // in the same ledger; skip duplicates. Gracefully absorb per-id failures
    // (nft_info is Clio-only — a rippled fallback will error).
    const mintedIds = new Set(mintURIs.map((m) => m.nftokenId));
    const toLookup = [...new Set(tradeNftIds)].filter(
      (id) => !mintedIds.has(id),
    );

    await Promise.allSettled(
      toLookup.map(async (nftokenId) => {
        try {
          const info = await getIngestionClient().getNFTInfo(nftokenId);
          if (info?.uri) {
            await recordKnownURI(nftokenId, info.uri);
          }
        } catch {
          // nft_info may fail on non-Clio nodes; skip silently.
        }
      }),
    );
  }

  /* ---------- Gap detection ---------- */

  private async detectAndFillGaps(): Promise<void> {
    if (!this.running) return;
    // Wait for any in-flight ledger processing to finish before gap-filling
    // to avoid concurrent transactions hitting the same aggregation rows.
    if (this.processing) return;

    const [latestRow] = await db
      .select()
      .from(ingestionState)
      .where(sql`${ingestionState.key} = 'latest_ledger'`);
    const [earliestRow] = await db
      .select()
      .from(ingestionState)
      .where(sql`${ingestionState.key} = 'earliest_ledger'`);

    const latest = Number(latestRow?.value ?? 0);
    const earliest = Number(earliestRow?.value ?? 0);

    if (latest === 0 || earliest === 0 || latest - earliest < 2) return;

    // Find missing ledgers in the range
    const gaps = await db.execute<{ missing: number }>(sql`
      SELECT s.i AS missing
      FROM generate_series(${earliest}::integer, ${latest}::integer) AS s(i)
      LEFT JOIN ingested_ledgers ON ingested_ledgers.ledger_index = s.i
      WHERE ingested_ledgers.ledger_index IS NULL
      LIMIT ${MAX_GAP_FILL_PER_CYCLE}
    `);

    if (gaps.length === 0) return;

    log.info({ gaps: gaps.length }, "Filling gaps");

    // Chain gap-fill ledgers through processingChain so they serialise with
    // live ledger processing — prevents concurrent DB transactions on the
    // same aggregation rows, and doesn't block live events with a long
    // `this.processing = true` hold.
    for (const gap of gaps) {
      if (!this.running) break;
      this.processingChain = this.processingChain
        .then(() => this.ingestLedger(gap.missing))
        .catch((err) => log.warn({ err, ledger: gap.missing }, "Gap fill failed"));
    }
  }

  // PG daily rollup method was here pre-2026-05-09.
  // All 6 daily tables (fee_burn_daily, tx_count_daily, payment_corridor_daily,
  // nft_volume_daily, token_volume_daily, wallet_trade_volume_daily) are now
  // populated by CH MVs — no PG rollup needed.

  /* ---------- Helpers ---------- */

  private async loadMarketplaceRegistry(): Promise<void> {
    const rows = await db.select().from(marketplaceRegistry);
    this.marketplaceMap.clear();
    for (const row of rows) {
      this.marketplaceMap.set(row.address, row.name);
    }
    log.info({ count: this.marketplaceMap.size }, "Loaded marketplaces");
  }

  private async loadTrackedAccounts(): Promise<void> {
    const rows = await db
      .select({ address: trackedAccounts.address })
      .from(trackedAccounts);
    this.trackedAccountSet = new Set(rows.map((r) => r.address));
    log.info({ count: this.trackedAccountSet.size }, "Loaded tracked accounts");
  }

  private async upsertState(key: string, value: string): Promise<void> {
    await db
      .insert(ingestionState)
      .values({ key, value })
      .onConflictDoUpdate({
        target: ingestionState.key,
        set: { value, updatedAt: new Date() },
      });
  }

  private parseLedgerIndex(raw: unknown): number | null {
    if (!raw || typeof raw !== "object") return null;
    const obj = raw as Record<string, unknown>;
    const index = Number(obj.ledger_index ?? 0);
    return index > 0 ? index : null;
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Find the AMM account address from a CreatedNode in AMMCreate metadata */
function findCreatedAMMAccount(
  nodes: { CreatedNode?: { LedgerEntryType: string; NewFields?: Record<string, unknown> } }[],
): string | null {
  for (const node of nodes) {
    if (node.CreatedNode?.LedgerEntryType === "AMM") {
      const fields = node.CreatedNode.NewFields;
      if (fields?.Account && typeof fields.Account === "string") {
        return fields.Account;
      }
    }
  }
  return null;
}

/** Find the deleted AMM account address from AMMDelete metadata */
function findDeletedAMMAccount(
  nodes: { DeletedNode?: { LedgerEntryType: string; FinalFields?: Record<string, unknown> } }[],
): string | null {
  for (const node of nodes) {
    if (node.DeletedNode?.LedgerEntryType === "AMM") {
      const fields = node.DeletedNode.FinalFields;
      if (fields?.Account && typeof fields.Account === "string") {
        return fields.Account;
      }
    }
  }
  return null;
}

/** Find updated trading fee from AMMVote metadata (ModifiedNode on AMM ledger entry) */
function findAMMVoteFeeUpdate(
  nodes: { ModifiedNode?: { LedgerEntryType: string; FinalFields?: Record<string, unknown> } }[],
): { account: string; tradingFee: number } | null {
  for (const node of nodes) {
    if (node.ModifiedNode?.LedgerEntryType === "AMM") {
      const fields = node.ModifiedNode.FinalFields;
      if (
        fields?.Account &&
        typeof fields.Account === "string" &&
        typeof fields.TradingFee === "number"
      ) {
        return { account: fields.Account, tradingFee: fields.TradingFee };
      }
    }
  }
  return null;
}

/** Parse AMMCreate transaction fields into asset pair + trading fee */
function parseAMMCreateAssets(
  tx: RawLedgerTx,
): { asset1Currency: string; asset1Issuer: string | null; asset2Currency: string; asset2Issuer: string | null; tradingFee: number | null } | null {
  const raw = tx as unknown as Record<string, unknown>;
  const amount = raw.Amount;
  const amount2 = raw.Amount2;
  if (!amount || !amount2) return null;

  function parseAsset(a: unknown): { currency: string; issuer: string | null } | null {
    if (typeof a === "string") return { currency: "XRP", issuer: null };
    if (typeof a === "object" && a !== null) {
      const obj = a as { currency?: string; issuer?: string };
      if (obj.currency) return { currency: obj.currency, issuer: obj.issuer ?? null };
    }
    return null;
  }

  const a1 = parseAsset(amount);
  const a2 = parseAsset(amount2);
  if (!a1 || !a2) return null;

  const tradingFee = typeof raw.TradingFee === "number" ? raw.TradingFee : null;

  return {
    asset1Currency: a1.currency,
    asset1Issuer: a1.issuer,
    asset2Currency: a2.currency,
    asset2Issuer: a2.issuer,
    tradingFee,
  };
}

/* ------------------------------------------------------------------ */
/*  Singleton + conditional startup                                    */
/* ------------------------------------------------------------------ */

// Dedicated WebSocket for ingestion — separate from the page-serving singleton.
// This prevents ingestion's heavy getLedger(expand=true) calls from competing
// with user-facing requests for the shared 1,000 msg/min rate limit.
// Lazy: only created on first access so no WS is opened when ingestion is disabled.
const globalForIngestion = globalThis as unknown as {
  __ingestionManager?: IngestionManager;
  __ingestionClient?: XrplClient;
};

/** Lazy ingestion client — only opens a WS when first accessed. */
export function getIngestionClient(): XrplClient {
  if (!globalForIngestion.__ingestionClient) {
    globalForIngestion.__ingestionClient = new XrplClient([
      "wss://honeycluster.io",
      "wss://s2.ripple.com",
    ]);
  }
  return globalForIngestion.__ingestionClient;
}

if (!globalForIngestion.__ingestionManager) {
  globalForIngestion.__ingestionManager = new IngestionManager();
}

export const ingestionManager = globalForIngestion.__ingestionManager;

/**
 * Call this to conditionally start ingestion based on env vars.
 * Safe to call multiple times — only starts once.
 */
export function initIngestion(): void {
  if (process.env.ENABLE_INGESTION !== "true") {
    log.info("Disabled (ENABLE_INGESTION !== true)");
    return;
  }
  if (!process.env.DATABASE_URL) {
    log.info("Disabled (no DATABASE_URL)");
    return;
  }

  ingestionManager.start().catch((err) => {
    log.error({ err }, "Failed to start");
  });
}
