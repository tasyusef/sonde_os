import AddressLink from "@/components/shared/AddressLink";
import InfoTip from "@/components/shared/InfoTip";
import type { AccountSettings } from "@/types/xrpl";

const ACCOUNT_FLAGS: Array<{ mask: number; label: string; description: string }> = [
  { mask: 0x00020000, label: "requireDestTag", description: "Destination tag required on incoming payments" },
  { mask: 0x00040000, label: "requireAuth", description: "Trust line authorization required" },
  { mask: 0x00080000, label: "disallowXRP", description: "XRP payments discouraged" },
  { mask: 0x00100000, label: "disableMaster", description: "Master key pair disabled" },
  { mask: 0x00200000, label: "noFreeze", description: "Cannot freeze trust lines" },
  { mask: 0x00400000, label: "globalFreeze", description: "All trust lines frozen" },
  { mask: 0x00800000, label: "defaultRipple", description: "Rippling enabled by default" },
  { mask: 0x01000000, label: "depositAuth", description: "Deposit authorization required" },
  { mask: 0x02000000, label: "isAMM", description: "AMM account" },
  { mask: 0x04000000, label: "disallowIncomingNFTokenOffer", description: "Incoming NFT offers disabled" },
  { mask: 0x08000000, label: "disallowIncomingCheck", description: "Incoming checks disabled" },
  { mask: 0x10000000, label: "disallowIncomingPayChan", description: "Incoming payment channels disabled" },
  { mask: 0x20000000, label: "disallowIncomingTrustline", description: "Incoming trust lines disabled" },
  { mask: 0x40000000, label: "allowTrustLineClawback", description: "Can claw back issued tokens" },
];

function hexToAscii(hex: string): string {
  let str = "";
  for (let i = 0; i < hex.length; i += 2) {
    const code = parseInt(hex.substring(i, i + 2), 16);
    if (code > 31 && code < 127) str += String.fromCharCode(code);
  }
  return str;
}

function formatTransferRate(rate: number): string {
  // TransferRate is 1,000,000,000 = 0% fee. 1,002,000,000 = 0.2% fee
  const fee = ((rate - 1_000_000_000) / 1_000_000_000) * 100;
  return `${fee.toFixed(4)}%`;
}

export default function SettingsList({ settings }: { settings: AccountSettings }) {
  const activeFlags = ACCOUNT_FLAGS.filter((f) => (settings.flags & f.mask) !== 0);
  const inactiveFlags = ACCOUNT_FLAGS.filter((f) => (settings.flags & f.mask) === 0);

  const properties: Array<{
    label: string;
    value: React.ReactNode;
    tip?: React.ReactNode;
  }> = [];

  if (settings.domain) {
    const decoded = hexToAscii(settings.domain);
    properties.push({ label: "Domain", value: <span className="font-mono text-cell text-primary">{decoded || settings.domain}</span> });
  }
  if (settings.regularKey) {
    properties.push({ label: "Regular Key", value: <AddressLink address={settings.regularKey} truncate={false} /> });
  }
  if (settings.transferRate && settings.transferRate !== 1_000_000_000) {
    properties.push({ label: "Transfer Fee", value: <span className="font-mono text-cell text-primary">{formatTransferRate(settings.transferRate)}</span> });
  }
  if (settings.tickSize) {
    properties.push({ label: "Tick Size", value: <span className="font-mono text-cell text-primary tabular-nums">{settings.tickSize}</span> });
  }
  if (settings.nfTokenMinter) {
    properties.push({
      label: "Authorized Minter",
      value: (
        <AddressLink address={settings.nfTokenMinter} truncate={false} />
      ),
      tip: (
        <>
          Account authorized to mint NFTs on this account&apos;s behalf.
          NFTs created by the delegate carry this account as the issuer.
        </>
      ),
    });
  }
  if (settings.mintedNFTokens !== undefined) {
    properties.push({ label: "NFTs Minted", value: <span className="font-mono text-cell text-primary tabular-nums">{settings.mintedNFTokens.toLocaleString()}</span> });
  }
  if (settings.burnedNFTokens !== undefined) {
    properties.push({ label: "NFTs Burned", value: <span className="font-mono text-cell text-primary tabular-nums">{settings.burnedNFTokens.toLocaleString()}</span> });
  }

  return (
    <div className="space-y-6">
      {/* Account Flags */}
      <div className="rounded-2xl shadow-card bg-surface p-6">
        <h3 className="mb-4 font-display text-lg font-medium text-primary">
          Account Flags
        </h3>
        {activeFlags.length === 0 ? (
          <p className="font-mono text-body text-muted">No flags enabled</p>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {activeFlags.map((f) => (
                <span
                  key={f.label}
                  className="rounded-tag px-2 py-0.5 font-mono text-tag font-medium bg-success/8 text-success"
                  title={f.description}
                >
                  {f.label}
                </span>
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              {activeFlags.map((f) => (
                <div key={f.label} className="flex items-start gap-2">
                  <span className="mt-0.5 inline-block size-1.5 shrink-0 rounded-full bg-success" />
                  <span className="font-mono text-cell text-secondary">{f.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {inactiveFlags.length > 0 && (
          <div className="mt-4 border-t border-elevated pt-4">
            <p className="mb-2 font-display text-label text-muted uppercase tracking-header">
              Inactive
            </p>
            <div className="flex flex-wrap gap-2">
              {inactiveFlags.map((f) => (
                <span
                  key={f.label}
                  className="rounded-tag px-2 py-0.5 font-mono text-tag font-medium bg-elevated text-muted"
                  title={f.description}
                >
                  {f.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Account Properties — mobile-first stacked layout. Long values
            (full addresses, hex domains) overflowed the right edge on
            narrow viewports; stacking puts the label above the value
            and lets the value wrap naturally. */}
      {properties.length > 0 && (
        <div className="rounded-2xl shadow-card bg-surface p-6">
          <h3 className="mb-4 font-display text-lg font-medium text-primary">
            Account Properties
          </h3>
          <div className="space-y-3">
            {properties.map((prop) => (
              <div
                key={prop.label}
                className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
              >
                <span className="flex shrink-0 items-center gap-1 font-display text-label font-medium uppercase tracking-header text-muted">
                  {prop.label}
                  {prop.tip && <InfoTip>{prop.tip}</InfoTip>}
                </span>
                <span className="min-w-0 break-all sm:text-right">
                  {prop.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
