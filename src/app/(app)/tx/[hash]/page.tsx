import type { Metadata } from "next";
import TransactionDetail from "@/components/tx/TransactionDetail";
import { xrplClient } from "@/lib/xrpl-client";
import { getTxByHash } from "@/lib/clickhouse-queries";
import type { TxResponse } from "@/types/xrpl-responses";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ hash: string }>;
}): Promise<Metadata> {
  const { hash } = await params;
  const truncated = `${hash.slice(0, 8)}...${hash.slice(-6)}`;
  return {
    title: `Transaction ${truncated} — XRPL`,
    description: `XRPL transaction ${truncated}: type, accounts, amount, fees, ledger index, and full meta breakdown — indexed by Sonde.`,
    alternates: { canonical: `/tx/${hash}` },
  };
}

export const dynamic = "force-dynamic";

/**
 * Fetch the tx with a CH-first strategy. CH already mirrors the full
 * tx + meta blobs for everything inside the backfill window, and the
 * lookup is local (no public-rippled round trip). Falls back to
 * rippled when CH misses — older than backfill, or live txs that
 * haven't replicated yet (~30s lag).
 *
 * The CH path also catches the rare case where rippled returns
 * transient errors but the tx is durably indexed locally.
 */
async function fetchTransaction(hash: string): Promise<TxResponse | null> {
  try {
    const fromCh = await getTxByHash(hash);
    if (fromCh) return fromCh;
  } catch {
    // CH unavailable / query failed — fall through to rippled. Tx pages
    // shouldn't 500 just because the analytics DB hiccuped.
  }
  return xrplClient.getTransaction(hash);
}

export default async function TransactionPage({
  params,
}: {
  params: Promise<{ hash: string }>;
}) {
  const { hash } = await params;

  let tx: TxResponse | null = null;
  let error: string | null = null;

  if (!/^[A-Fa-f0-9]{64}$/.test(hash)) {
    error = "Invalid transaction hash format";
  } else {
    try {
      tx = await fetchTransaction(hash);
    } catch {
      error = "Transaction not found";
    }
  }

  return (
    <div className="min-h-screen">
      <main id="main-content" className="mx-auto max-w-container px-4 py-6 sm:px-6 sm:py-8">
        {error ? (
          <div role="alert" className="rounded-2xl shadow-card bg-surface p-6 text-center sm:p-8">
            <p className="font-mono text-cell text-error">{error}</p>
            <p className="mt-2 break-all font-mono text-body text-muted">
              Hash: {hash}
            </p>
          </div>
        ) : tx ? (
          // getTransaction() returns TxResponse; TransactionDetail expects TxData
          // (structurally compatible at runtime, different meta sub-types at compile time)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          <TransactionDetail tx={tx as any} />
        ) : null}
      </main>
    </div>
  );
}
