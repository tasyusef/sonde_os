import Link from "next/link";
import { truncateHash } from "@/lib/xrpl-helpers";
import type { AffectedNodeEntry } from "./index";

interface ParsedNode {
  status: "CREATED" | "MODIFIED" | "DELETED";
  ledgerEntryType: string;
  ledgerIndex: string;
  previousTxnID?: string;
  previousTxnLgrSeq?: number;
}

function parseNodes(nodes: AffectedNodeEntry[]): ParsedNode[] {
  return nodes.map((node) => {
    if (node.CreatedNode) {
      return {
        status: "CREATED" as const,
        ledgerEntryType: node.CreatedNode.LedgerEntryType,
        ledgerIndex: node.CreatedNode.LedgerIndex,
      };
    }
    if (node.ModifiedNode) {
      return {
        status: "MODIFIED" as const,
        ledgerEntryType: node.ModifiedNode.LedgerEntryType,
        ledgerIndex: node.ModifiedNode.LedgerIndex,
        previousTxnID: node.ModifiedNode.PreviousTxnID,
        previousTxnLgrSeq: node.ModifiedNode.PreviousTxnLgrSeq,
      };
    }
    if (node.DeletedNode) {
      return {
        status: "DELETED" as const,
        ledgerEntryType: node.DeletedNode.LedgerEntryType,
        ledgerIndex: node.DeletedNode.LedgerIndex,
      };
    }
    return {
      status: "MODIFIED" as const,
      ledgerEntryType: "Unknown",
      ledgerIndex: "",
    };
  });
}

const STATUS_STYLES: Record<string, string> = {
  CREATED: "bg-success/10 text-success",
  MODIFIED: "bg-warning/10 text-warning",
  DELETED: "bg-error/10 text-error",
};

const ENTRY_TYPE_STYLES: Record<string, string> = {
  AccountRoot: "bg-tx-account/10 text-tx-account",
  RippleState: "bg-tx-trust/10 text-tx-trust",
  Offer: "bg-tx-offer/10 text-tx-offer",
  DirectoryNode: "bg-tx-nft/10 text-tx-nft",
  NFTokenPage: "bg-tx-nft/10 text-tx-nft",
  NFTokenOffer: "bg-tx-nft/10 text-tx-nft",
  PayChannel: "bg-tx-escrow/10 text-tx-escrow",
  Escrow: "bg-tx-escrow/10 text-tx-escrow",
  AMM: "bg-tx-amm/10 text-tx-amm",
};

function entryTypeStyle(type: string): string {
  return ENTRY_TYPE_STYLES[type] ?? "bg-elevated text-secondary";
}

export default function AffectedNodes({ nodes }: { nodes: AffectedNodeEntry[] }) {
  const parsed = parseNodes(nodes);

  if (parsed.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
      <div className="border-b border-elevated px-4 py-2.5">
        <h2 className="font-display text-body font-semibold text-primary">
          Affected Nodes
        </h2>
      </div>
      {/* Desktop / tablet: full table. Mobile: cards. The 5-col layout
          horizontal-scrolls fine on tablet via overflow-x-auto, but on a
          phone it forces scroll-then-read-then-scroll for every row. */}
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-elevated">
              <th scope="col" className="w-10 px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                #
              </th>
              <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                Status
              </th>
              <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                Ledger entry type
              </th>
              <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                Object ID
              </th>
              <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                Previous transaction
              </th>
            </tr>
          </thead>
          <tbody>
            {parsed.map((node, i) => (
              <tr
                key={`${node.ledgerIndex}-${i}`}
                className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
              >
                <td className="px-4 py-row font-mono text-cell text-muted">
                  {i + 1}
                </td>
                <td className="px-4 py-row">
                  <span
                    className={`inline-block rounded-tag px-1.5 py-0.5 text-tag font-medium uppercase ${
                      STATUS_STYLES[node.status] ?? "bg-elevated text-muted"
                    }`}
                  >
                    {node.status}
                  </span>
                </td>
                <td className="px-4 py-row">
                  <span
                    className={`inline-block rounded-tag px-1.5 py-0.5 text-tag font-medium uppercase ${
                      entryTypeStyle(node.ledgerEntryType)
                    }`}
                  >
                    {node.ledgerEntryType}
                  </span>
                </td>
                <td className="px-4 py-row">
                  {node.ledgerIndex ? (
                    <span
                      className="font-mono text-cell text-muted"
                      title={node.ledgerIndex}
                    >
                      {truncateHash(node.ledgerIndex, 10)}
                    </span>
                  ) : (
                    <span className="font-mono text-cell text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-row">
                  {node.previousTxnID ? (
                    <span className="flex items-center gap-2">
                      <Link
                        href={`/tx/${node.previousTxnID}`}
                        className="font-mono text-cell text-muted transition-colors hover:text-secondary"
                        title={node.previousTxnID}
                      >
                        {truncateHash(node.previousTxnID, 7)}
                      </Link>
                      {node.previousTxnLgrSeq != null && (
                        <Link
                          href={`/ledger/${node.previousTxnLgrSeq}`}
                          className="rounded-tag bg-brand/10 px-1.5 py-0.5 font-mono text-tag font-medium text-brand transition-colors hover:bg-brand/20"
                        >
                          {node.previousTxnLgrSeq.toLocaleString()}
                        </Link>
                      )}
                    </span>
                  ) : (
                    <span className="font-mono text-cell text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card layout */}
      <div className="sm:hidden">
        {parsed.map((node, i) => (
          <div
            key={`${node.ledgerIndex}-${i}`}
            className="border-b border-elevated px-4 py-3 last:border-b-0"
          >
            <div className="flex items-center gap-2">
              <span className="font-mono text-label text-muted">#{i + 1}</span>
              <span
                className={`rounded-tag px-1.5 py-0.5 text-tag font-medium uppercase ${
                  STATUS_STYLES[node.status] ?? "bg-elevated text-muted"
                }`}
              >
                {node.status}
              </span>
              <span
                className={`rounded-tag px-1.5 py-0.5 text-tag font-medium uppercase ${
                  entryTypeStyle(node.ledgerEntryType)
                }`}
              >
                {node.ledgerEntryType}
              </span>
            </div>
            {node.ledgerIndex && (
              <div className="mt-2 flex flex-col gap-0.5">
                <span className="font-display text-label uppercase tracking-header text-muted">
                  Object ID
                </span>
                <span className="font-mono text-cell text-muted" title={node.ledgerIndex}>
                  {truncateHash(node.ledgerIndex, 10)}
                </span>
              </div>
            )}
            {node.previousTxnID && (
              <div className="mt-2 flex flex-col gap-0.5">
                <span className="font-display text-label uppercase tracking-header text-muted">
                  Previous transaction
                </span>
                <span className="flex items-center gap-2">
                  <Link
                    href={`/tx/${node.previousTxnID}`}
                    className="font-mono text-cell text-muted transition-colors hover:text-secondary"
                    title={node.previousTxnID}
                  >
                    {truncateHash(node.previousTxnID, 7)}
                  </Link>
                  {node.previousTxnLgrSeq != null && (
                    <Link
                      href={`/ledger/${node.previousTxnLgrSeq}`}
                      className="rounded-tag bg-brand/10 px-1.5 py-0.5 font-mono text-tag font-medium text-brand transition-colors hover:bg-brand/20"
                    >
                      {node.previousTxnLgrSeq.toLocaleString()}
                    </Link>
                  )}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
