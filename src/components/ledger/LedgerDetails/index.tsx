import { Link } from "react-router";
import CopyButton from "@/components/shared/CopyButton";
import Facts, { Fact } from "@/components/shared/Facts";
import Section from "@/components/shared/Section";
import { formatDropsAsXrp, splitDateTime } from "@/lib/format";
import type { ExpandedLedger } from "@/lib/ledger-txs";
import { formatDate, truncate } from "@/lib/xrpl-helpers";

/** The ledger page's rail: when it closed, the XRP in existence then,
 *  and the ledger before it. */
export default function LedgerDetails({ ledger }: { ledger: ExpandedLedger }) {
  const closed = splitDateTime(formatDate(ledger.close_time));
  const parentIndex = Number(ledger.ledger_index) - 1;

  return (
    <Section title="Details">
      <Facts>
        <Fact label="Closed">
          {closed.date}
          <span className="block text-tag text-muted">{closed.time}</span>
        </Fact>
        <Fact label="Total coins">
          <span className="tabular-nums">{formatDropsAsXrp(ledger.total_coins)}</span>{" "}
          <span className="text-muted">XRP</span>
        </Fact>
        <Fact label="Parent">
          <span className="inline-flex items-center gap-1">
            <Link to={`/ledger/${parentIndex}`} className="link">
              {truncate(ledger.parent_hash)}
            </Link>
            <CopyButton text={ledger.parent_hash} />
          </span>
        </Fact>
      </Facts>
    </Section>
  );
}
