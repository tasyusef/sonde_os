import { xrplClient } from "./xrpl-client";
import { recentTxCache, recentMintsCache, feeCache, serverHealthCache, networkStatsCache, txDistributionCache } from "./cache";
import { getTypeFamily, getTypeColor } from "./xrpl-helpers";
import type { NetworkStats, RecentTx, TxSummary } from "@/types/live-data";
import type { ServerHealth, FeeInfo, TxTypeDistribution } from "@/types/network";
import type {
  ServerInfoResponse,
  FeeResponse,
  TxResponse,
  TxMeta,
  ExpandedLedgerResponse,
} from "@/types/xrpl-responses";

export type { NetworkStats, RecentTx };

export async function getNetworkStats(): Promise<NetworkStats> {
  const cached = networkStatsCache.get("stats") as NetworkStats | undefined;
  if (cached) return cached;

  const [ledgerResult, serverResult] = await Promise.all([
    xrplClient.getLedger("validated"),
    xrplClient.send({ command: "server_info" }) as Promise<ServerInfoResponse>,
  ]);

  const ledger = ledgerResult.ledger;
  const info = serverResult.info.validated_ledger;

  const stats: NetworkStats = {
    ledgerIndex: ledger.ledger_index,
    txCount: ledger.transactions?.length ?? 0,
    closeTime: ledger.close_time,
    totalCoins: ledger.total_coins,
    baseFee: info?.base_fee_xrp?.toString() ?? "0.000012",
    // Defaults reflect current XRPL mainnet (post-ReserveCut amendment).
    reserveBase: info?.reserve_base_xrp ?? 1,
    reserveIncrement: info?.reserve_inc_xrp ?? 0.2,
  };

  networkStatsCache.set("stats", stats);
  return stats;
}

export async function getRecentTransactions(): Promise<{
  txs: RecentTx[];
  total: number;
  mints: RecentMint[];
  /** Lightweight per-tx summaries for visual dot grids. */
  txSummaries: TxSummary[];
  /** Total fees burned in the ledger (drops). */
  totalFees: string;
}> {
  // Check cache first (5s TTL)
  const cached = recentTxCache.get("recent") as
    | { txs: RecentTx[]; total: number; mints: RecentMint[]; txSummaries: TxSummary[]; totalFees: string }
    | undefined;
  if (cached) return cached;

  // Use getLedger() to share the ledgerCache with getLedgerTxDistribution() —
  // avoids firing two parallel expanded-ledger requests per cycle.
  const result = await xrplClient.getLedger("validated", true);

  const txs = result.ledger.transactions ?? [];
  const total = txs.length;

  // Extract NFTokenMint transactions from the same expanded ledger (no extra call)
  const mints: RecentMint[] = [];
  collectMints(txs, mints, 4);

  // Build lightweight tx summaries for dot grid + sum fees
  let feeSum = 0n;
  const txSummaries: TxSummary[] = txs.map((tx) => {
    try { feeSum += BigInt(tx.Fee ?? "0"); } catch { /* skip */ }
    return {
      hash: tx.hash,
      type: tx.TransactionType,
      result: tx.meta?.TransactionResult ?? tx.metaData?.TransactionResult ?? "",
    };
  });

  const data = {
    total,
    txs: txs.slice(0, 15).map((tx) => ({
      hash: tx.hash,
      type: tx.TransactionType,
      account: tx.Account,
      destination: tx.Destination,
      amount: typeof tx.Amount === "string" ? tx.Amount : undefined,
      fee: tx.Fee,
      result: tx.meta?.TransactionResult ?? tx.metaData?.TransactionResult ?? "",
      date: tx.date,
      ledgerIndex: tx.ledger_index,
    })),
    mints,
    txSummaries,
    totalFees: feeSum.toString(),
  };

  recentTxCache.set("recent", data);
  return data;
}

export interface RecentMint {
  hash: string;
  account: string;
  nftokenId: string;
  uri: string | null;
  date?: number;
  ledgerIndex?: number;
}

/** In-flight promise dedup — prevents duplicate scans when multiple callers hit cold cache */
let mintsInflight: Promise<RecentMint[]> | null = null;

const MINT_COUNT = 4;

export async function getRecentNFTMints(): Promise<RecentMint[]> {
  const cached = recentMintsCache.get("mints") as RecentMint[] | undefined;
  if (cached) return cached;

  // Dedup: if a scan is already in-flight, piggyback on it
  if (mintsInflight) return mintsInflight;

  // Hard timeout so the Suspense boundary can't hang forever
  const SCAN_TIMEOUT = 15_000; // 15 seconds max

  mintsInflight = (async () => {
    const mints: RecentMint[] = [];
    const MAX_LEDGERS = 20; // ~1 minute of history at ~3s per ledger

    // Fetch the latest validated ledger
    const first = (await xrplClient.send({
      command: "ledger",
      ledger_index: "validated",
      transactions: true,
      expand: true,
    })) as ExpandedLedgerResponse;

    const ledgerIndex = first.ledger.ledger_index;
    collectMints(first.ledger.transactions ?? [], mints, MINT_COUNT);

    // Scan backwards in batches of 5 until we have enough mints
    let offset = 1;
    while (mints.length < MINT_COUNT && offset < MAX_LEDGERS) {
      const batchSize = Math.min(5, MAX_LEDGERS - offset);
      const indices = Array.from({ length: batchSize }, (_, i) => ledgerIndex - offset - i);
      offset += batchSize;

      const batch = await Promise.all(
        indices.map((idx) =>
          xrplClient
            .send({ command: "ledger", ledger_index: idx, transactions: true, expand: true })
            .catch(() => null) as Promise<ExpandedLedgerResponse | null>
        )
      );

      for (const result of batch) {
        if (mints.length >= MINT_COUNT) break;
        if (result?.ledger.transactions) {
          collectMints(result.ledger.transactions, mints, MINT_COUNT);
        }
      }
    }

    recentMintsCache.set("mints", mints);
    return mints;
  })();

  try {
    return await Promise.race([
      mintsInflight,
      new Promise<RecentMint[]>((_, reject) =>
        setTimeout(() => reject(new Error("NFT mints scan timed out")), SCAN_TIMEOUT),
      ),
    ]);
  } finally {
    mintsInflight = null;
  }
}

/** Extract the minted NFTokenID from transaction metadata AffectedNodes */
export function extractNFTokenId(meta: TxMeta | undefined): string | null {
  if (!meta) return null;

  // 1. Check top-level convenience field (modern rippled)
  if (meta.nftoken_id) return meta.nftoken_id;

  const nodes = meta.AffectedNodes;
  if (!nodes) return null;

  // 2. Check CreatedNode entries for NFTokenID in NewFields
  for (const node of nodes) {
    if (node.CreatedNode?.NewFields?.NFTokenID) {
      return node.CreatedNode.NewFields.NFTokenID;
    }
  }

  // 3. Diff ModifiedNode NFTokenPage to find the newly added token
  for (const node of nodes) {
    const mod = node.ModifiedNode;
    if (mod?.LedgerEntryType !== "NFTokenPage") continue;
    const finalTokens = mod.FinalFields?.NFTokens ?? [];
    const prevTokens = mod.PreviousFields?.NFTokens ?? [];

    // If PreviousFields has no NFTokens, all tokens in FinalFields are candidates
    // but this is unusual; typically the page existed before
    if (prevTokens.length === 0 && finalTokens.length > 0) {
      // Return the last token (most recently added)
      return finalTokens[finalTokens.length - 1].NFToken.NFTokenID;
    }

    // Find the new token by comparing arrays
    const prevIds = new Set(prevTokens.map((t) => t.NFToken.NFTokenID));
    for (const t of finalTokens) {
      if (!prevIds.has(t.NFToken.NFTokenID)) {
        return t.NFToken.NFTokenID;
      }
    }
  }

  // 4. Check CreatedNode NFTokenPage (first token on a new page)
  for (const node of nodes) {
    const created = node.CreatedNode;
    if (created?.LedgerEntryType !== "NFTokenPage") continue;
    const tokens = created.NewFields?.NFTokens ?? [];
    if (tokens.length > 0) {
      return tokens[tokens.length - 1].NFToken.NFTokenID;
    }
  }

  return null;
}

function collectMints(txs: TxResponse[], mints: RecentMint[], limit: number) {
  for (const tx of txs) {
    if (mints.length >= limit) break;
    if (tx.TransactionType !== "NFTokenMint") continue;
    const result = tx.meta?.TransactionResult ?? tx.metaData?.TransactionResult ?? "";
    if (result !== "tesSUCCESS") continue;
    const nftokenId = extractNFTokenId(tx.meta) ?? extractNFTokenId(tx.metaData);
    if (!nftokenId) continue;

    mints.push({
      hash: tx.hash,
      account: tx.Account,
      nftokenId,
      uri: tx.URI ?? null,
      date: tx.date,
      ledgerIndex: tx.ledger_index,
    });
  }
}

export async function getServerHealth(): Promise<ServerHealth> {
  const cached = serverHealthCache.get("health") as ServerHealth | undefined;
  if (cached) return cached;

  const result = (await xrplClient.send({
    command: "server_info",
  })) as ServerInfoResponse;

  const info = result.info;
  const data: ServerHealth = {
    buildVersion: info.build_version ?? (info.clio_version ? `Clio ${info.clio_version}` : "unknown"),
    loadFactor: info.load_factor ?? 1,
    serverState: info.server_state ?? (info.validated_ledger ? "validated" : "unknown"),
    quorum: info.validation_quorum ?? 0,
    completeLedgers: info.complete_ledgers ?? "—",
    validatedSeq: info.validated_ledger?.seq ?? 0,
  };

  serverHealthCache.set("health", data);
  return data;
}

export async function getFeeInfo(): Promise<FeeInfo> {
  const cached = feeCache.get("fee") as FeeInfo | undefined;
  if (cached) return cached;

  const result = (await xrplClient.send({
    command: "fee",
  })) as FeeResponse;

  const data: FeeInfo = {
    baseFeeDrops: result.drops.base_fee,
    medianFeeDrops: result.drops.median_fee,
    minimumFeeDrops: result.drops.minimum_fee,
    openLedgerFeeDrops: result.drops.open_ledger_fee,
    queueSize: result.current_queue_size,
    expectedLedgerSize: result.expected_ledger_size,
    maxQueueSize: result.max_queue_size,
  };

  feeCache.set("fee", data);
  return data;
}

export async function getLedgerTxDistribution(): Promise<{
  distribution: TxTypeDistribution[];
  total: number;
}> {
  const cached = txDistributionCache.get("dist") as
    | { distribution: TxTypeDistribution[]; total: number }
    | undefined;
  if (cached) return cached;

  const result = await xrplClient.getLedger(
    "validated",
    true,
  );

  const txs = result.ledger.transactions ?? [];
  const total = txs.length;

  // Group by family
  const familyCounts = new Map<string, { count: number; color: string }>();
  for (const tx of txs) {
    const family = getTypeFamily(tx.TransactionType);
    const existing = familyCounts.get(family);
    if (existing) {
      existing.count++;
    } else {
      familyCounts.set(family, {
        count: 1,
        color: getTypeColor(tx.TransactionType),
      });
    }
  }

  const distribution: TxTypeDistribution[] = Array.from(familyCounts.entries())
    .map(([family, { count, color }]) => ({
      family,
      count,
      percentage: total > 0 ? Math.round((count / total) * 1000) / 10 : 0,
      color,
    }))
    .sort((a, b) => b.count - a.count);

  const data = { distribution, total };
  txDistributionCache.set("dist", data);
  return data;
}
