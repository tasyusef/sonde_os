import { Link } from "react-router";
import CopyButton from "@/components/shared/CopyButton";
import Facts, { Fact } from "@/components/shared/Facts";
import Section from "@/components/shared/Section";
import { dropsToXrp, formatDate, truncate, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import { heroTone } from "./hero-amount";
import { TONE_TEXT } from "./TxHero";
import type { TxData } from "./types";

function relativeTime(rippleTime: number): string {
  const seconds = Math.floor((Date.now() - (rippleTime + XRPL_EPOCH) * 1000) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function computeCTID(ledgerIndex: number, txIndex: number, networkId: number): string {
  // CTID = C + ledger_seq (28 bits) + txn_index (16 bits) + network_id (16 bits)
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, (0xc0 << 24) | (ledgerIndex & 0x0fffffff));
  view.setUint16(4, txIndex & 0xffff);
  view.setUint16(6, networkId & 0xffff);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join("");
}

/** A value with a copy button, for identifiers in the rail. */
function Copyable({ text, shown = text }: { text: string; shown?: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {shown}
      <CopyButton text={text} />
    </span>
  );
}

/** The tx page's rail: where and when it landed, what it cost, and the
 *  identifiers you'd look it up by. */
export default function TxFacts({ tx }: { tx: TxData }) {
  const meta = tx.meta ?? tx.metaData;
  const result = meta?.TransactionResult;
  const ledgerIndex = tx.ledger_index ?? tx.inLedger;
  const txIndex =
    typeof tx.TransactionIndex === "number"
      ? tx.TransactionIndex
      : typeof meta?.TransactionIndex === "number"
        ? meta.TransactionIndex
        : null;
  // Mainnet's network ID is 0.
  const ctid = ledgerIndex != null && txIndex != null ? computeCTID(ledgerIndex, txIndex, 0) : null;
  const signers = tx.Signers?.length ?? 0;

  return (
    <Section title="Details">
      <Facts>
        <Fact label="Result">
          {/* Result codes are data (tesSUCCESS, tecNO_DST): mono, never case-transformed. */}
          <span className={TONE_TEXT[heroTone(result)]}>{result ?? "Pending"}</span>
        </Fact>
        {tx.date != null && (
          <Fact label="Date">
            {formatDate(tx.date)}
            <span className="block text-tag text-muted">{relativeTime(tx.date)}</span>
          </Fact>
        )}
        <Fact label="Ledger">
          {ledgerIndex != null ? (
            <Link to={`/ledger/${ledgerIndex}`} className="link tabular-nums">
              {ledgerIndex.toLocaleString()}
            </Link>
          ) : (
            <span className="text-muted">—</span>
          )}
        </Fact>
        {txIndex != null && (
          <Fact label="Tx index">
            <span className="tabular-nums">{txIndex.toLocaleString()}</span>
          </Fact>
        )}
        <Fact label="Fee">
          <span className="tabular-nums">{dropsToXrp(tx.Fee)}</span> <span className="text-muted">XRP</span>
        </Fact>
        {tx.Sequence != null && (
          <Fact label="Sequence">
            <span className="tabular-nums">{tx.Sequence.toLocaleString()}</span>
          </Fact>
        )}
        {tx.Flags != null && tx.Flags !== 0 && (
          <Fact label="Flags">
            <span className="tabular-nums">{tx.Flags}</span>
          </Fact>
        )}
        {tx.SourceTag != null && (
          <Fact label="Source tag">
            <span className="tabular-nums">{tx.SourceTag}</span>
          </Fact>
        )}
        {ctid && (
          <Fact label="CTID">
            <Copyable text={ctid} />
          </Fact>
        )}
        <Fact label="Signing key">
          {signers > 0 ? (
            `Multi-sig, ${signers} signers`
          ) : tx.SigningPubKey ? (
            <Copyable text={tx.SigningPubKey} shown={truncate(tx.SigningPubKey, 6)} />
          ) : (
            <span className="text-muted">—</span>
          )}
        </Fact>
      </Facts>
    </Section>
  );
}
