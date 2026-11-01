import type { ReactNode } from "react";
import Section from "@/components/shared/Section";
import StageRail from "@/components/shared/StageRail";
import RawJsonToggle from "@/components/tx/RawJsonToggle";
import AffectedNodes from "./AffectedNodes";
import BalanceChanges from "./BalanceChanges";
import TxFacts from "./TxFacts";
import TxHero from "./TxHero";
import { getTypeFields } from "./TypeFields";
import type { AffectedNodeEntry, TxData } from "./types";

export type { AffectedNodeEntry, TxData } from "./types";

/** A field of the tx's own type: label left, value beside it, unruled.
 *  Values run long (memos, URIs), so they read left to right, not as
 *  right-aligned facts. */
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 py-2 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="font-display text-caps uppercase tracking-header text-muted sm:w-36 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-cell text-primary">{children}</dd>
    </div>
  );
}

/**
 * The tx page, laid out like the NFT and account pages: the transaction
 * on the stage, its facts in the rail, then the fields its type carries,
 * what it changed, and the raw JSON across the full width.
 */
export default function TransactionDetail({ tx }: { tx: TxData }) {
  const meta = tx.meta ?? tx.metaData;
  const affectedNodes = (meta?.AffectedNodes ?? []) as AffectedNodeEntry[];
  const typeFields = getTypeFields(tx);

  return (
    <>
      <StageRail stage={<TxHero tx={tx} />} rail={<TxFacts tx={tx} />} />

      {/* Skipped when the type has none, so a Payment without memos
           doesn't show an empty section. */}
      {typeFields.length > 0 && (
        <Section title="Type details" className="mt-16">
          <dl>
            {typeFields.map((field) => (
              <Row key={field.label} label={field.label}>
                {field.content}
              </Row>
            ))}
          </dl>
        </Section>
      )}

      {affectedNodes.length > 0 && (
        <>
          <BalanceChanges className="mt-16" affectedNodes={affectedNodes} txAccount={tx.Account} fee={tx.Fee} />
          <AffectedNodes className="mt-16" nodes={affectedNodes} />
        </>
      )}

      <RawJsonToggle className="mt-16" tx={tx} meta={meta ?? null} />
    </>
  );
}
