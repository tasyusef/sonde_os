import ListNotice from "@/components/shared/ListNotice";
import Section from "@/components/shared/Section";
import HeldTable from "./HeldTable";
import IssuedTable from "./IssuedTable";

export interface MPToken {
  LedgerEntryType: "MPToken";
  MPTokenIssuanceID: string;
  /** Absent for a zero balance. */
  MPTAmount?: string;
  LockedAmount?: string;
  Flags: number;
  index: string;
}

export interface MPTokenIssuance {
  LedgerEntryType: "MPTokenIssuance";
  Issuer: string;
  /** With `Issuer`, makes the issuance ID (`mptIssuanceId`). */
  Sequence: number;
  OutstandingAmount?: string;
  MaximumAmount?: string;
  AssetScale?: number;
  TransferFee?: number;
  MPTokenMetadata?: string;
  Flags: number;
  index: string;
}

/**
 * MPTokens the account holds and issues. When it does both, each table
 * gets its own heading.
 */
export default function MPTokenList({
  mpTokens,
  mpTokenIssuances,
}: {
  mpTokens: MPToken[];
  mpTokenIssuances: MPTokenIssuance[];
}) {
  if (mpTokens.length === 0 && mpTokenIssuances.length === 0) {
    return <ListNotice message="No multi-purpose tokens found." />;
  }

  const held = <HeldTable tokens={mpTokens} />;
  const issued = <IssuedTable issuances={mpTokenIssuances} />;
  if (mpTokenIssuances.length === 0) return held;
  if (mpTokens.length === 0) return issued;

  return (
    <div className="space-y-8">
      <Section title="Held" count={mpTokens.length}>
        {held}
      </Section>
      <Section title="Issued" count={mpTokenIssuances.length}>
        {issued}
      </Section>
    </div>
  );
}
