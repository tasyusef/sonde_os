/**
 * AffectedNodes → `account_tx_index` extractor.
 *
 * Walks a single transaction's `meta.AffectedNodes` and emits per-account
 * rows for the `account_tx_index` ClickHouse table. Captures the
 * relationships invisible to the existing tables:
 *
 *   - `transactions` PK is keyed on the tx's sender (`account` column).
 *   - `value_transfer_events` is keyed on the receiver of value
 *     (`to_account`) and only covers Payment / AccountDelete / CheckCash /
 *     Clawback / payment_source kinds.
 *
 * Anything else — your offer got crossed by someone's Payment, your AMM
 * LP shares moved when another LP deposited, your trustline balance
 * changed by side effect — is invisible until indexed here.
 *
 * Roles emitted (mutually exclusive per (account, role) pair within a tx):
 *   - `offer_owner`            — your `Offer` ledger entry was modified
 *                                 or deleted by another account's tx
 *                                 (most commonly: offer crossed)
 *   - `amm_lp`                 — your `RippleState` with an AMM
 *                                 pseudo-account changed (LP shares
 *                                 moved, swap routed through the AMM,
 *                                 etc.)
 *   - `trustline_peer`         — your `RippleState` peer side modified
 *                                 (non-AMM trustline)
 *   - `account_root_modified`  — your `AccountRoot` was modified by a
 *                                 tx where you're not the Account or
 *                                 Destination (catch-all for indirect
 *                                 reserve/sequence updates)
 *
 * Sender + destination are intentionally excluded — those relationships
 * already live in `transactions` PK and `value_transfer_events`. This
 * extractor is the AffectedNodes-only delta, NOT a full mirror.
 *
 * Failed txs (`TransactionResult !== 'tesSUCCESS'`) are skipped: their
 * AffectedNodes can include partial state from path-finding work that
 * didn't ultimately apply, which would create misleading "this account
 * was touched" claims.
 *
 * The function is pure — no I/O, no side effects, deterministic for a
 * given (rawTx, meta) input. Both the live ingester and the slice-5b
 * backfill consume it.
 */

import type { RawLedgerTx, TxMeta, AffectedNode } from "@/types/ingestion";

export type AccountTxIndexRole =
  | "offer_owner"
  | "amm_lp"
  | "trustline_peer"
  | "account_root_modified";

export interface AccountTxIndexRow {
  [key: string]: string | number;
  account: string;
  /** CH `DateTime` literal: `YYYY-MM-DD HH:MM:SS` (UTC). */
  timestamp: string;
  tx_hash: string;
  ledger_index: number;
  tx_type: string;
  role: string;
}

/** XRPL epoch (2000-01-01 UTC) → unix epoch offset in seconds.
 *  Duplicated from `xrpl-helpers` to keep the extractor zero-import. */
const XRPL_EPOCH_OFFSET_S = 946_684_800;

/** ClickHouse FixedString(64) requires exactly 64 hex chars. Same shape
 *  as `fixedHash` in `ledger-ingester.ts`; duplicated to avoid a
 *  cross-module import cycle. */
function fixedHash(h: string | undefined | null): string {
  const s = (h ?? "").toUpperCase();
  if (s.length === 64) return s;
  return s.padEnd(64, "0").slice(0, 64);
}

/** Read the most-relevant fields object from any of the three node
 *  variants. CreatedNode has NewFields; ModifiedNode has FinalFields
 *  (with PreviousFields as the diff source); DeletedNode has FinalFields. */
function readFields(node: AffectedNode): Record<string, unknown> | null {
  if (node.CreatedNode) return node.CreatedNode.NewFields ?? null;
  if (node.ModifiedNode) return node.ModifiedNode.FinalFields ?? null;
  if (node.DeletedNode) return node.DeletedNode.FinalFields ?? null;
  return null;
}

function readEntryType(node: AffectedNode): string | null {
  return (
    node.CreatedNode?.LedgerEntryType ??
    node.ModifiedNode?.LedgerEntryType ??
    node.DeletedNode?.LedgerEntryType ??
    null
  );
}

/** First pass over AffectedNodes to identify AMM pseudo-accounts. Two
 *  detection paths because not every AMM op modifies both:
 *
 *   1. `AccountRoot` with `AMMID` field — fires for ops that touch the
 *      AMM's balance (`extractAmmFillsFromTx` uses this path).
 *   2. `AMM` ledger entry directly — its `Account` field is the
 *      pseudo-account address. Fires for AMMDeposit / Withdraw which
 *      modify the AMM ledger entry but not necessarily its
 *      AccountRoot.
 *
 *  Smoketest revealed the single-path approach missed `amm_lp`
 *  classification on AMMDeposit, since those modify the AMM ledger
 *  entry without touching the AccountRoot. */
function collectAmmAccounts(nodes: AffectedNode[]): Set<string> {
  const ammAccounts = new Set<string>();
  for (const node of nodes) {
    const entryType = readEntryType(node);
    const fields = readFields(node);
    if (!fields) continue;

    if (entryType === "AccountRoot") {
      if (typeof fields.AMMID === "string" && fields.AMMID.length > 0) {
        const account = fields.Account;
        if (typeof account === "string" && account.length > 0) {
          ammAccounts.add(account);
        }
      }
    } else if (entryType === "AMM") {
      // The AMM ledger entry stores the pseudo-account in its `Account`
      // field (not always present on every variant — fall through if
      // absent rather than throwing).
      const account = fields.Account;
      if (typeof account === "string" && account.length > 0) {
        ammAccounts.add(account);
      }
    }
  }
  return ammAccounts;
}

export function extractAccountTxIndex(
  rawTx: RawLedgerTx,
  ledger: { ledger_index: number; close_time: number },
): AccountTxIndexRow[] {
  const meta: TxMeta | undefined = rawTx.meta ?? rawTx.metaData;
  if (!meta || meta.TransactionResult !== "tesSUCCESS") return [];

  const nodes = meta.AffectedNodes ?? [];
  if (nodes.length === 0) return [];

  const exclude = new Set<string>();
  if (rawTx.Account) exclude.add(rawTx.Account);
  if (rawTx.Destination) exclude.add(rawTx.Destination);

  const ammAccounts = collectAmmAccounts(nodes);

  const txDateSeconds = (rawTx.date ?? ledger.close_time) + XRPL_EPOCH_OFFSET_S;
  const timestamp = new Date(txDateSeconds * 1000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
  const txHash = fixedHash(rawTx.hash);
  const txType = rawTx.TransactionType;
  const ledgerIndex = ledger.ledger_index;

  const rowMap = new Map<string, AccountTxIndexRow>();
  function add(account: string | undefined, role: AccountTxIndexRole) {
    if (!account || exclude.has(account)) return;
    const key = `${account}|${role}`;
    if (rowMap.has(key)) return;
    rowMap.set(key, {
      account,
      timestamp,
      tx_hash: txHash,
      ledger_index: ledgerIndex,
      tx_type: txType,
      role,
    });
  }

  for (const node of nodes) {
    const entryType = readEntryType(node);
    const fields = readFields(node);
    if (!entryType || !fields) continue;

    if (entryType === "Offer") {
      const owner = fields.Account;
      if (typeof owner === "string") add(owner, "offer_owner");
      continue;
    }

    if (entryType === "RippleState") {
      // RippleState's two participants live under HighLimit.issuer and
      // LowLimit.issuer. The issuer-side / holder-side distinction
      // matters for what we emit:
      //
      //   - Holder side has `Limit.value > "0"` — they trust the issuer
      //     for some amount of the IOU. This is the user-account that
      //     would want to see "my trustline balance changed" in their
      //     activity feed.
      //   - Issuer side has `Limit.value === "0"` — they don't extend
      //     trust in their own IOU; they ARE the IOU. Standard XRPL
      //     convention. Emitting this side floods the table with
      //     issuer rows on every routed payment (audit caught this:
      //     69% of pre-fix rows were issuer-side trustline_peer noise).
      //
      // Same skip applies to the AMM pseudo-account on AMM-token
      // trustlines (the AMM is the LP-token issuer, value === "0",
      // and also in `ammAccounts`).
      const highLimit = fields.HighLimit as { issuer?: unknown; value?: unknown } | undefined;
      const lowLimit = fields.LowLimit as { issuer?: unknown; value?: unknown } | undefined;
      const highAddr = typeof highLimit?.issuer === "string" ? highLimit.issuer : undefined;
      const lowAddr = typeof lowLimit?.issuer === "string" ? lowLimit.issuer : undefined;
      const highIsIssuer = highLimit?.value === "0";
      const lowIsIssuer = lowLimit?.value === "0";

      if (highAddr && !highIsIssuer && !ammAccounts.has(highAddr)) {
        const role = lowAddr && ammAccounts.has(lowAddr) ? "amm_lp" : "trustline_peer";
        add(highAddr, role);
      }
      if (lowAddr && !lowIsIssuer && !ammAccounts.has(lowAddr)) {
        const role = highAddr && ammAccounts.has(highAddr) ? "amm_lp" : "trustline_peer";
        add(lowAddr, role);
      }
      continue;
    }

    if (entryType === "AccountRoot") {
      const account = fields.Account;
      // Skip AMM AccountRoots — pseudo-accounts, not user wallets. Their
      // LP-side relationships are captured via the RippleState branch.
      if (typeof account === "string" && !ammAccounts.has(account)) {
        add(account, "account_root_modified");
      }
      continue;
    }

    // DirectoryNode, AMM, NFTokenPage, etc. don't carry an account we'd
    // surface on the account page. Skip silently.
  }

  return Array.from(rowMap.values());
}
