import Link from "next/link";
import AddressLink from "@/components/shared/AddressLink";
import HashLink from "@/components/shared/HashLink";
import AmountDisplay from "@/components/shared/AmountDisplay";
import CopyButton from "@/components/shared/CopyButton";
import InfoTip from "@/components/shared/InfoTip";
import { formatDate, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import type { AncestryData } from "@/hooks/useAccountData";
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
/*  Detail row                                                         */
/* ------------------------------------------------------------------ */

/** Mobile-first row. On narrow viewports the long values (full
 *  addresses, 64-char tx hashes, hex CTIDs) overflowed the right side
 *  of the card. Stacked layout below sm; horizontal label/value at sm+. */
function Row({
  label,
  labelTip,
  children,
}: {
  label: string;
  /** Optional InfoTip content rendered next to the label. */
  labelTip?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-b border-elevated px-4 py-2.5 last:border-b-0 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <span className="flex shrink-0 items-center gap-1 font-display text-label font-medium uppercase tracking-header text-muted">
        {label}
        {labelTip && <InfoTip>{labelTip}</InfoTip>}
      </span>
      <span className="min-w-0 break-all font-mono text-cell text-primary sm:text-right">
        {children}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AncestryDisplay({
  ancestry,
  accountSettings,
}: {
  ancestry: AncestryData;
  accountSettings: AccountSettings;
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
    <div className="space-y-6">
      {/* Activation / Origin */}
      <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
        <div className="border-b border-elevated px-4 py-2">
          <span className="font-display text-label font-medium uppercase tracking-header text-muted">
            Origin
          </span>
        </div>

        {ancestry.parentAddress ? (
          <>
            <Row label="Activated By">
              <AddressLink address={ancestry.parentAddress} truncate={false} />
            </Row>
            {ancestry.activationDate != null && (
              <Row label="Activation Date">
                <span className="flex items-center justify-end gap-2">
                  {formatDate(ancestry.activationDate)}
                  {ageDisplay && (
                    <span className="rounded-tag bg-elevated px-1.5 py-0.5 text-tag font-medium text-muted">
                      {ageDisplay}
                    </span>
                  )}
                </span>
              </Row>
            )}
            {ancestry.fundingAmount && (
              <Row label="Funding Amount">
                <AmountDisplay drops={ancestry.fundingAmount} />
              </Row>
            )}
            {ancestry.activationHash && (
              <Row label="Activation Tx">
                <HashLink hash={ancestry.activationHash} truncate={false} />
              </Row>
            )}
            {activationCTID && (
              <Row label="Activation CTID">
                <span className="flex items-center justify-end gap-2">
                  <span className="text-muted">{activationCTID}</span>
                  <CopyButton text={activationCTID} />
                </span>
              </Row>
            )}
            {ancestry.activationLedgerIndex != null && (
              <Row label="Activation Ledger">
                <Link
                  href={`/ledger/${ancestry.activationLedgerIndex}`}
                  className="text-brand transition-colors hover:text-brand-light"
                >
                  {ancestry.activationLedgerIndex.toLocaleString()}
                </Link>
              </Row>
            )}
          </>
        ) : (
          <div className="px-4 py-6 text-center">
            <p className="font-mono text-body text-muted">Ancestry data unavailable</p>
          </div>
        )}
      </div>

      {/* Account Root */}
      <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
        <div className="border-b border-elevated px-4 py-2">
          <span className="font-display text-label font-medium uppercase tracking-header text-muted">
            Account Root
          </span>
        </div>

        {accountSettings.regularKey && (
          <Row label="Regular Key">
            <AddressLink address={accountSettings.regularKey} truncate={false} />
          </Row>
        )}

        {domain && (
          <Row label="Domain">
            <a
              href={`https://${domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand transition-colors hover:text-brand-light"
            >
              {domain}
            </a>
          </Row>
        )}

        {transferRate && (
          <Row label="Transfer Rate">
            {transferRate}
          </Row>
        )}

        {accountSettings.tickSize != null && accountSettings.tickSize > 0 && (
          <Row label="Tick Size">
            {accountSettings.tickSize}
          </Row>
        )}

        {accountSettings.nfTokenMinter && (
          <Row
            label="Authorized Minter"
            labelTip={
              <>
                Account authorized to mint NFTs on this account&apos;s
                behalf. NFTs created by the delegate carry this account
                as the issuer.
              </>
            }
          >
            <AddressLink address={accountSettings.nfTokenMinter} truncate={false} />
          </Row>
        )}

        {(accountSettings.mintedNFTokens ?? 0) > 0 && (
          <Row label="Minted NFTs">
            {accountSettings.mintedNFTokens?.toLocaleString()}
          </Row>
        )}

        {(accountSettings.burnedNFTokens ?? 0) > 0 && (
          <Row label="Burned NFTs">
            {accountSettings.burnedNFTokens?.toLocaleString()}
          </Row>
        )}

        <Row label="Account Flags">
          {activeFlags.length > 0 ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              {activeFlags.map((flag) => (
                <span
                  key={flag}
                  className="rounded-tag bg-elevated px-1.5 py-0.5 text-tag font-medium text-secondary"
                >
                  {flag}
                </span>
              ))}
            </div>
          ) : (
            <span className="text-muted">None</span>
          )}
        </Row>
      </div>
    </div>
  );
}
