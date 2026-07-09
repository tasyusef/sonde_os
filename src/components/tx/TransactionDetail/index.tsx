import TypeTag from "@/components/shared/TypeTag";
import StatusBadge from "@/components/shared/StatusBadge";
import CopyButton from "@/components/shared/CopyButton";
import { getTypeFields } from "./TypeFields";
import HeroCard from "./HeroCard";
import BalanceChanges from "./BalanceChanges";
import AffectedNodes from "./AffectedNodes";
import RawJsonToggle from "@/components/tx/RawJsonToggle";

interface TxMeta {
  TransactionResult: string;
  delivered_amount?: unknown;
  AffectedNodes?: AffectedNodeEntry[];
  [key: string]: unknown;
}

export interface AffectedNodeEntry {
  CreatedNode?: {
    LedgerEntryType: string;
    LedgerIndex: string;
    NewFields?: Record<string, unknown>;
  };
  ModifiedNode?: {
    LedgerEntryType: string;
    LedgerIndex: string;
    FinalFields?: Record<string, unknown>;
    PreviousFields?: Record<string, unknown>;
    PreviousTxnID?: string;
    PreviousTxnLgrSeq?: number;
  };
  DeletedNode?: {
    LedgerEntryType: string;
    LedgerIndex: string;
    FinalFields?: Record<string, unknown>;
  };
}

interface TxData {
  TransactionType: string;
  Account: string;
  Destination?: string;
  DestinationTag?: number;
  SourceTag?: number;
  Amount?: unknown;
  Fee: string;
  Sequence?: number;
  Flags?: number;
  hash: string;
  date?: number;
  ledger_index?: number;
  inLedger?: number;
  SigningPubKey?: string;
  Signers?: Array<{
    Signer: {
      Account: string;
      SigningPubKey: string;
      TxnSignature: string;
    };
  }>;
  meta?: TxMeta;
  metaData?: TxMeta;
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ */
/*  CTID computation                                                   */
/* ------------------------------------------------------------------ */

function computeCTID(ledgerIndex: number, txIndex: number, networkId: number): string {
  // CTID = C + ledger_seq (28 bits) + txn_index (16 bits) + network_id (16 bits)
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, (0xC0 << 24) | (ledgerIndex & 0x0FFFFFFF));
  view.setUint16(4, txIndex & 0xFFFF);
  view.setUint16(6, networkId & 0xFFFF);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

/* ------------------------------------------------------------------ */
/*  Detail row                                                         */
/* ------------------------------------------------------------------ */

function Row({
  label,
  children,
  highlight,
}: {
  label: string;
  children: React.ReactNode;
  highlight?: "success" | "error";
}) {
  return (
    <div
      className={`flex flex-col gap-1 border-b border-elevated px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:gap-4 ${
        highlight === "success"
          ? "bg-success/5"
          : highlight === "error"
            ? "bg-error/5"
            : ""
      }`}
    >
      <span className="font-display text-label font-medium uppercase tracking-header text-muted sm:w-[140px] sm:shrink-0 sm:normal-case sm:tracking-normal">
        {label}
      </span>
      <span className="min-w-0 font-mono text-cell text-primary">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

export default async function TransactionDetail({ tx }: { tx: TxData }) {
  const meta = tx.meta ?? tx.metaData;
  const result = meta?.TransactionResult ?? "";
  const isSuccess = result === "tesSUCCESS";
  const affectedNodes = (meta?.AffectedNodes ?? []) as AffectedNodeEntry[];

  // Compute CTID (mainnet network_id = 0)
  const ledgerIndex = tx.ledger_index ?? tx.inLedger;
  let ctid: string | null = null;
  if (ledgerIndex != null) {
    // tx index from meta — find this tx's position in the ledger
    const txIndex = typeof tx.TransactionIndex === "number"
      ? tx.TransactionIndex
      : typeof (meta as Record<string, unknown>)?.TransactionIndex === "number"
        ? (meta as Record<string, unknown>).TransactionIndex as number
        : null;
    if (txIndex != null) {
      ctid = computeCTID(ledgerIndex, txIndex, 0);
    }
  }

  // Signing key detection
  const isMultiSig = Array.isArray(tx.Signers) && tx.Signers.length > 0;
  const signerCount = isMultiSig ? tx.Signers!.length : 0;
  const signingPubKey = tx.SigningPubKey;

  // Pull the type-specific fields up front so we can decide whether
  // to render the "Type-specific Details" card chrome at all. Async
  // because NFT-related types resolve metadata over the network.
  const typeFields = await getTypeFields(tx);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-title font-bold tracking-[-0.3px] text-primary">
          Transaction
        </h1>
        <TypeTag txType={tx.TransactionType} />
        <StatusBadge
          status={isSuccess ? "success" : "error"}
          label={isSuccess ? "SUCCESS" : "FAILED"}
        />
      </div>

      {/* Hero — the story of the tx: parties, amount, when, where,
           fee. Absorbs the user-facing summary from the old
           Specification/Outcome 2-col split so the tech-metadata
           grid below it can be naturally balanced. */}
      <HeroCard tx={tx} />

      {/* 2-col tech-metadata grid. With parties/amount/ledger/fee/
           index pulled into the hero and TypeFields extracted to its
           own card below, Identifiers and Outcome have similar row
           counts (3–4 each) and read as a balanced pair. items-start
           still — if one runs a row longer, we'd rather see honest
           short-card heights than dead chrome stretched to match. */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* Left: Identifiers */}
        <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
          <div className="border-b border-elevated px-4 py-2">
            <span className="font-display text-label font-medium uppercase tracking-header text-muted">
              Identifiers
            </span>
          </div>

          <Row label="Tx hash">
            <span className="flex items-center gap-2 break-all">
              <span className="text-muted">{tx.hash}</span>
              <CopyButton text={tx.hash} />
            </span>
          </Row>

          {ctid && (
            <Row label="CTID">
              <span className="flex items-center gap-2">
                <span className="text-muted">{ctid}</span>
                <CopyButton text={ctid} />
              </span>
            </Row>
          )}

          <Row label="Signing key">
            {isMultiSig ? (
              <span className="flex items-center gap-2">
                <span className="rounded-tag bg-brand/10 px-1.5 py-0.5 text-tag font-medium text-brand">
                  Multi-signature ({signerCount} Signers)
                </span>
              </span>
            ) : signingPubKey ? (
              <span className="break-all text-muted">{signingPubKey}</span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </Row>

          {tx.SourceTag != null && (
            <Row label="Source Tag">
              <span className="text-secondary">{tx.SourceTag}</span>
            </Row>
          )}
        </div>

        {/* Right: Outcome */}
        <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
          <div className="border-b border-elevated px-4 py-2">
            <span className="font-display text-label font-medium uppercase tracking-header text-muted">
              Outcome
            </span>
          </div>

          <Row label="Result">
            <span className={isSuccess ? "text-success" : "text-error"}>
              {result}
            </span>
          </Row>

          {tx.Sequence != null && (
            <Row label="Tx seq">
              {tx.Sequence.toLocaleString()}
            </Row>
          )}

          {tx.Flags != null && tx.Flags !== 0 && (
            <Row label="Flags">
              {tx.Flags}
            </Row>
          )}
        </div>
      </div>

      {/* Type-specific details — variable tail of fields that depend
           on tx type (TakerPays/TakerGets for OfferCreate, LimitAmount
           for TrustSet, NFT metadata + URI for NFT ops, Memos, etc.).
           Skipped entirely when the type has no specific fields, so
           Payments without memos don't render an empty card. */}
      {typeFields.length > 0 && (
        <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
          <div className="border-b border-elevated px-4 py-2">
            <span className="font-display text-label font-medium uppercase tracking-header text-muted">
              Type-specific Details
            </span>
          </div>
          {typeFields.map((field) => (
            <Row key={field.label} label={field.label}>
              {field.content}
            </Row>
          ))}
        </div>
      )}

      {/* Raw JSON + Receipt buttons */}
      <RawJsonToggle tx={tx} meta={meta ?? null} />

      {/* Balance Changes */}
      {affectedNodes.length > 0 && (
        <BalanceChanges
          affectedNodes={affectedNodes}
          txAccount={tx.Account}
          fee={tx.Fee}
        />
      )}

      {/* Affected Nodes */}
      {affectedNodes.length > 0 && (
        <AffectedNodes nodes={affectedNodes} />
      )}
    </div>
  );
}
