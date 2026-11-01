import { Link } from "react-router";
import HashLink from "@/components/shared/HashLink";
import Section from "@/components/shared/Section";
import { cell, thClass } from "@/lib/table";
import { cn } from "@/lib/utils";
import { truncateHash } from "@/lib/xrpl-helpers";
import type { AffectedNodeEntry } from "./types";

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
  CREATED: "tag-success",
  MODIFIED: "bg-elevated text-muted",
  DELETED: "tag-error",
};

const ENTRY_TYPE_STYLES: Record<string, string> = {
  AccountRoot: "tag-account",
  RippleState: "tag-trust",
  Offer: "tag-offer",
  DirectoryNode: "tag-nft",
  NFTokenPage: "tag-nft",
  NFTokenOffer: "tag-nft",
  PayChannel: "tag-escrow",
  Escrow: "tag-escrow",
  AMM: "tag-amm",
};

function entryTypeStyle(type: string): string {
  return ENTRY_TYPE_STYLES[type] ?? "bg-elevated text-primary";
}

const TAG = "rounded-tag px-1.5 py-0.5 text-tag font-medium uppercase";

/**
 * Every ledger entry the transaction touched. Mobile-first, same
 * pattern as `EscrowList`:
 *
 *   Below lg: Status (+ entry type, object ID) | Previous transaction
 *   lg+:      # | Status | Ledger entry type | Object ID | Previous transaction
 *
 * Below lg a row is two lines, so cells sit at the top; `min-h-5` holds
 * the previous hash to a tag's 20px box so its text lines up with the
 * tags'. From lg every cell is one line and they centre. A long entry
 * type wraps inside its tag rather than overflow the column.
 */
export default function AffectedNodes({
  nodes,
  className,
}: {
  nodes: AffectedNodeEntry[];
  className?: string;
}) {
  const parsed = parseNodes(nodes);

  if (parsed.length === 0) return null;

  return (
    <Section title="Affected nodes" count={parsed.length} className={className}>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="hidden lg:table-column lg:w-10" />
          <col className="w-auto lg:w-24" />
          <col className="hidden lg:table-column lg:w-auto" />
          <col className="hidden lg:table-column lg:w-52" />
          <col className="w-[42%] lg:w-64" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} hidden text-left lg:table-cell`}>
              #
            </th>
            <th scope="col" className={`${thClass} text-left max-lg:pl-0`}>
              <span className="lg:hidden">Status / Type</span>
              <span className="hidden lg:inline">Status</span>
            </th>
            <th scope="col" className={`${thClass} hidden text-left lg:table-cell`}>
              Ledger entry type
            </th>
            <th scope="col" className={`${thClass} hidden text-left lg:table-cell`}>
              Object ID
            </th>
            <th scope="col" className={`${thClass} text-left`}>
              Previous transaction
            </th>
          </tr>
        </thead>
        <tbody>
          {parsed.map((node, i) => (
            <tr
              key={`${node.ledgerIndex}-${i}`}
              className="border-b border-line last:border-b-0 hover:bg-row-hover"
            >
              <td className={`${cell} hidden font-mono text-cell text-muted lg:table-cell`}>
                {i + 1}
              </td>
              <td className={`${cell} max-lg:pl-0 max-lg:align-top`}>
                <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                  <span className={cn(TAG, STATUS_STYLES[node.status] ?? "bg-elevated text-muted")}>
                    {node.status}
                  </span>
                  {/* Folded here until its own column appears at lg. */}
                  <span
                    className={cn(
                      TAG,
                      "max-w-full break-words lg:hidden",
                      entryTypeStyle(node.ledgerEntryType),
                    )}
                  >
                    {node.ledgerEntryType}
                  </span>
                </div>
                {node.ledgerIndex && (
                  <span
                    className="mt-1 block break-words font-mono text-cell text-muted lg:hidden"
                    title={node.ledgerIndex}
                  >
                    <span className="sr-only">Object ID </span>
                    {truncateHash(node.ledgerIndex, 10)}
                  </span>
                )}
              </td>
              <td className={`${cell} hidden lg:table-cell`}>
                <span
                  className={cn(
                    TAG,
                    "inline-block max-w-full break-words",
                    entryTypeStyle(node.ledgerEntryType),
                  )}
                >
                  {node.ledgerEntryType}
                </span>
              </td>
              <td className={`${cell} hidden font-mono text-cell text-muted lg:table-cell`}>
                {node.ledgerIndex ? (
                  <span title={node.ledgerIndex}>{truncateHash(node.ledgerIndex, 10)}</span>
                ) : (
                  "—"
                )}
              </td>
              <td className={`${cell} max-lg:align-top`}>
                <span className="flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1">
                  {node.previousTxnID ? (
                    <>
                      <HashLink hash={node.previousTxnID} chars={7} />
                      {node.previousTxnLgrSeq != null && (
                        <Link
                          to={`/ledger/${node.previousTxnLgrSeq}`}
                          className="rounded-tag bg-elevated px-1.5 py-0.5 font-mono text-tag text-primary hover:bg-primary hover:text-black"
                        >
                          {node.previousTxnLgrSeq.toLocaleString()}
                        </Link>
                      )}
                    </>
                  ) : (
                    <span className="font-mono text-cell text-muted">—</span>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
