import { Link } from "react-router";
import AddressLink from "@/components/shared/AddressLink";
import HashLink from "@/components/shared/HashLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import CopyButton from "@/components/shared/CopyButton";
import Facts, { Fact } from "@/components/shared/Facts";
import InfoTip from "@/components/shared/InfoTip";
import ListNotice from "@/components/shared/ListNotice";
import Section from "@/components/shared/Section";
import { formatDate, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import type { AncestryData } from "@/hooks/useAccountAncestry";
import type { AccountSettings } from "@/types/xrpl";

/* ------------------------------------------------------------------ */
/*  CTID computation (same as TransactionDetail)                       */
/* ------------------------------------------------------------------ */

function computeCTID(ledgerIndex: number, txIndex: number, networkId: number): string {
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
/*  Account flag decoder                                               */
/* ------------------------------------------------------------------ */

const ACCOUNT_FLAGS: Array<{ mask: number; name: string; description: string }> = [
  { mask: 0x00010000, name: "lsfPasswordSpent", description: "Password spent" },
  { mask: 0x00020000, name: "lsfRequireDestTag", description: "Require destination tag" },
  { mask: 0x00040000, name: "lsfRequireAuth", description: "Require authorization" },
  { mask: 0x00080000, name: "lsfDisallowXRP", description: "Disallow XRP" },
  { mask: 0x00100000, name: "lsfDisableMaster", description: "Master key disabled" },
  { mask: 0x00200000, name: "lsfNoFreeze", description: "No freeze" },
  { mask: 0x00400000, name: "lsfGlobalFreeze", description: "Global freeze" },
  { mask: 0x00800000, name: "lsfDefaultRipple", description: "Default ripple" },
  { mask: 0x01000000, name: "lsfDepositAuth", description: "Deposit authorization" },
  { mask: 0x02000000, name: "lsfAuthorizedNFTokenMinter", description: "Authorized NFT minter" },
  { mask: 0x04000000, name: "lsfDisallowIncomingNFTOffer", description: "Disallow incoming NFT offers" },
  { mask: 0x08000000, name: "lsfDisallowIncomingCheck", description: "Disallow incoming checks" },
  { mask: 0x10000000, name: "lsfDisallowIncomingPayChan", description: "Disallow incoming payment channels" },
  { mask: 0x20000000, name: "lsfDisallowIncomingTrustline", description: "Disallow incoming trust lines" },
  { mask: 0x40000000, name: "lsfAMM", description: "AMM account" },
  { mask: 0x80000000, name: "lsfAllowTrustLineClawback", description: "Allow trust line clawback" },
];

function decodeFlags(flags: number): string[] {
  return ACCOUNT_FLAGS
    .filter((f) => (flags & f.mask) !== 0)
    .map((f) => f.description);
}

/* ------------------------------------------------------------------ */
/*  Hex domain decoder                                                 */
/* ------------------------------------------------------------------ */

function decodeDomain(hex: string): string {
  try {
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return hex;
  }
}

/* ------------------------------------------------------------------ */
/*  Age formatter (pure — uses XRPL_EPOCH constant)                    */
/* ------------------------------------------------------------------ */

function formatAge(rippleTime: number): string {
  const ms = (rippleTime + XRPL_EPOCH) * 1000;
  const days = Math.max(0, Math.floor((Date.now() - ms) / 86400000));
  return days >= 365
    ? `${Math.floor(days / 365)} years, ${Math.floor((days % 365) / 30)} months`
    : days >= 30
      ? `${Math.floor(days / 30)} months, ${days % 30} days`
      : `${days} days`;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AncestryDisplay({
  ancestry,
  accountSettings,
  onRetry,
}: {
  ancestry: AncestryData;
  accountSettings: AccountSettings;
  /** Set when the activation lookup failed: Origin shows an error. */
  onRetry?: () => void;
}) {
  const activeFlags = decodeFlags(accountSettings.flags);
  const domain = accountSettings.domain ? decodeDomain(accountSettings.domain) : null;
  const transferRate = accountSettings.transferRate
    ? ((accountSettings.transferRate - 1000000000) / 10000000).toFixed(2) + "%"
    : null;

  // Compute activation CTID
  let activationCTID: string | null = null;
  if (ancestry.activationLedgerIndex != null && ancestry.activationTxIndex != null) {
    activationCTID = computeCTID(ancestry.activationLedgerIndex, ancestry.activationTxIndex, 0);
  }

  // Age display — computed from activation date (already shown in stat cards above)
  const ageDisplay = ancestry.activationDate != null
    ? formatAge(ancestry.activationDate)
    : null;

  return (
    <div className="space-y-12">
      <Section title="Origin">
        {ancestry.parentAddress ? (
          <Facts>
            <Fact label="Activated By">
              <AddressLink address={ancestry.parentAddress} truncate={false} />
            </Fact>
            {ancestry.activationDate != null && (
              <Fact label="Activation Date">
                <span className="flex items-center justify-end gap-2">
                  {formatDate(ancestry.activationDate)}
                  {ageDisplay && (
                    <span className="rounded-tag bg-elevated px-1.5 py-0.5 text-tag font-medium text-muted">
                      {ageDisplay}
                    </span>
                  )}
                </span>
              </Fact>
            )}
            {ancestry.fundingAmount && (
              <Fact label="Funding Amount">
                <AmountDisplay drops={ancestry.fundingAmount} />
              </Fact>
            )}
            {ancestry.activationHash && (
              <Fact label="Activation Tx">
                <HashLink hash={ancestry.activationHash} truncate={false} />
              </Fact>
            )}
            {activationCTID && (
              <Fact label="Activation CTID">
                <span className="flex items-center justify-end gap-2">
                  <span className="text-muted">{activationCTID}</span>
                  <CopyButton text={activationCTID} />
                </span>
              </Fact>
            )}
            {ancestry.activationLedgerIndex != null && (
              <Fact label="Activation Ledger">
                <Link
                  to={`/ledger/${ancestry.activationLedgerIndex}`}
                  className="link text-primary"
                >
                  {ancestry.activationLedgerIndex.toLocaleString()}
                </Link>
              </Fact>
            )}
          </Facts>
        ) : onRetry ? (
          <ListNotice
            tone="error"
            message="Couldn't look up who activated this account."
            action={{ label: "Try again", onClick: onRetry }}
          />
        ) : (
          <ListNotice message="Ancestry data unavailable." />
        )}
      </Section>

      <Section title="Account Root">
        <Facts>
          {accountSettings.regularKey && (
            <Fact label="Regular Key">
              <AddressLink address={accountSettings.regularKey} truncate={false} />
            </Fact>
          )}

          {domain && (
            <Fact label="Domain">
              <a
                href={`https://${domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="link text-primary"
              >
                {domain}
              </a>
            </Fact>
          )}

          {transferRate && (
            <Fact label="Transfer Rate">
              {transferRate}
            </Fact>
          )}

          {accountSettings.tickSize != null && accountSettings.tickSize > 0 && (
            <Fact label="Tick Size">
              {accountSettings.tickSize}
            </Fact>
          )}

          {accountSettings.nfTokenMinter && (
            <Fact
              label={
                <span className="inline-flex items-center gap-1">
                  Authorized Minter
                  <InfoTip>
                    Account authorized to mint NFTs on this account&apos;s
                    behalf. NFTs created by the delegate carry this account
                    as the issuer.
                  </InfoTip>
                </span>
              }
            >
              <AddressLink address={accountSettings.nfTokenMinter} truncate={false} />
            </Fact>
          )}

          {(accountSettings.mintedNFTokens ?? 0) > 0 && (
            <Fact label="Minted NFTs">
              {accountSettings.mintedNFTokens?.toLocaleString()}
            </Fact>
          )}

          {(accountSettings.burnedNFTokens ?? 0) > 0 && (
            <Fact label="Burned NFTs">
              {accountSettings.burnedNFTokens?.toLocaleString()}
            </Fact>
          )}

          <Fact label="Account Flags">
            {activeFlags.length > 0 ? (
              <div className="flex flex-wrap justify-end gap-1.5">
                {activeFlags.map((flag) => (
                  <span
                    key={flag}
                    className="rounded-tag bg-elevated px-1.5 py-0.5 text-tag font-medium text-primary"
                  >
                    {flag}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-muted">None</span>
            )}
          </Fact>
        </Facts>
      </Section>
    </div>
  );
}
