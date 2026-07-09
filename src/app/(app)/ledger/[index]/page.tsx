import type { Metadata } from "next";
import LedgerHeader from "@/components/ledger/LedgerHeader";
import LedgerTransactionList from "@/components/ledger/LedgerTransactionList";
import { xrplClient } from "@/lib/xrpl-client";
import { getTxsForLedger } from "@/lib/clickhouse-queries";
import { type RecentTx } from "@/lib/xrpl-data";
import type { TxResponse } from "@/types/xrpl-responses";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ index: string }>;
}): Promise<Metadata> {
  const { index } = await params;
  const num = Number(index);
  const formatted = Number.isFinite(num) && num > 0 ? num.toLocaleString("en-US") : index;
  return {
    title: `Ledger #${formatted} — XRPL`,
    description: `XRPL ledger ${formatted}: close time, parent hash, total coins, transaction count and full transaction list — indexed by Sonde.`,
    alternates: { canonical: `/ledger/${index}` },
  };
}

export const dynamic = "force-dynamic";

/** Extended ledger shape — getLedger returns these extra fields at runtime */
interface LedgerDetail {
  ledger_index: number;
  ledger_hash: string;
  close_time: number;
  parent_hash: string;
  total_coins: string;
  transactions?: TxResponse[];
}

/** Map a rippled-shaped TxResponse onto the explorer's RecentTx row.
 *  Used only on the rippled fallback path. */
function parseTx(tx: TxResponse): RecentTx {
  return {
    hash: tx.hash,
    type: tx.TransactionType,
    account: tx.Account,
    destination: tx.Destination,
    amount: typeof tx.Amount === "string" ? tx.Amount : undefined,
    fee: tx.Fee,
    result:
      tx.meta?.TransactionResult ?? tx.metaData?.TransactionResult ?? "",
    date: tx.date,
    ledgerIndex: tx.ledger_index,
  };
}

/**
 * Fetch the ledger header + tx list with a hybrid strategy:
 *   - Header (close_time, total_coins, parent_hash) → rippled. We don't
 *     mirror per-ledger metadata in CH today, and the call is cheap
 *     (single round trip, no tx expansion).
 *   - Tx list → CH first (uses ledger_index minmax, no rippled fan-out).
 *     Falls back to rippled with `expand: true` if CH returns empty,
 *     which would mean the ledger predates our backfill window.
 */
async function fetchLedger(ledgerIndex: number): Promise<{
  ledger: LedgerDetail;
  transactions: RecentTx[];
}> {
  // Header + CH txs in parallel — header has no dependency on the tx list.
  const [headerResult, chTxs] = await Promise.all([
    xrplClient.getLedger(ledgerIndex, false),
    getTxsForLedger(ledgerIndex).catch(() => []),
  ]);

  const ledger = headerResult.ledger as LedgerDetail;

  if (chTxs.length > 0) {
    // CH already has the full tx list shaped for the explorer UI; reuse
    // verbatim instead of round-tripping rippled with `expand: true`.
    return { ledger, transactions: chTxs };
  }

  // CH miss — likely a ledger older than the backfill window, or a
  // very recent one that ingestion hasn't caught yet. Fall back to
  // rippled-with-expansion so the page still renders.
  const expanded = await xrplClient.getLedger(ledgerIndex, true);
  const expandedLedger = expanded.ledger as LedgerDetail;
  return {
    // Prefer the expanded header (richer) when we end up calling rippled twice.
    ledger: expandedLedger,
    transactions: expandedLedger.transactions?.map(parseTx) ?? [],
  };
}

export default async function LedgerPage({
  params,
}: {
  params: Promise<{ index: string }>;
}) {
  const { index } = await params;
  const ledgerIndex = parseInt(index, 10);

  let ledger: LedgerDetail | null = null;
  let transactions: RecentTx[] = [];
  let error: string | null = null;

  if (isNaN(ledgerIndex) || ledgerIndex < 1) {
    error = "Invalid ledger index";
  } else {
    try {
      const result = await fetchLedger(ledgerIndex);
      ledger = result.ledger;
      transactions = result.transactions;
    } catch {
      error = "Ledger not found";
    }
  }

  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        {error ? (
          <div role="alert" className="rounded-2xl shadow-card bg-surface p-6 text-center sm:p-8">
            <p className="font-mono text-cell text-error">{error}</p>
            <p className="mt-2 break-all font-mono text-body text-muted">
              Ledger: {index}
            </p>
          </div>
        ) : ledger ? (
          <>
            <LedgerHeader ledger={ledger} txCount={transactions.length} />
            <LedgerTransactionList transactions={transactions} />
          </>
        ) : null}
      </main>
    </div>
  );
}
