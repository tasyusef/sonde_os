import AddressLink from "@/components/shared/AddressLink";
import Facts, { Fact } from "@/components/shared/Facts";
import InfoTip from "@/components/shared/InfoTip";
import ListNotice from "@/components/shared/ListNotice";
import Section from "@/components/shared/Section";
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
  { mask: 0x40000000, label: "allowTrustLineLocking", description: "Issued tokens can be held in escrow" },
  { mask: 0x80000000, label: "allowTrustLineClawback", description: "Can claw back issued tokens" },
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
    properties.push({ label: "Domain", value: decoded || settings.domain });
  }
  if (settings.regularKey) {
    properties.push({ label: "Regular Key", value: <AddressLink address={settings.regularKey} truncate={false} /> });
  }
  if (settings.transferRate && settings.transferRate !== 1_000_000_000) {
    properties.push({ label: "Transfer Fee", value: formatTransferRate(settings.transferRate) });
  }
  if (settings.tickSize) {
    properties.push({ label: "Tick Size", value: <span className="tabular-nums">{settings.tickSize}</span> });
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
    properties.push({ label: "NFTs Minted", value: <span className="tabular-nums">{settings.mintedNFTokens.toLocaleString()}</span> });
  }
  if (settings.burnedNFTokens !== undefined) {
    properties.push({ label: "NFTs Burned", value: <span className="tabular-nums">{settings.burnedNFTokens.toLocaleString()}</span> });
  }

  return (
    <div className="space-y-12">
      <Section title="Account Flags">
        {activeFlags.length === 0 ? (
          <ListNotice message="No flags enabled." />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {activeFlags.map((f) => (
                <span
                  key={f.label}
                  className="rounded-tag px-2 py-0.5 font-mono text-tag font-medium tag-success"
                  title={f.description}
                >
                  {f.label}
                </span>
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              {activeFlags.map((f) => (
                <div key={f.label} className="flex items-start gap-2">
                  <span className="mt-0.5 inline-block size-1.5 shrink-0 rounded-full bg-success-mark" />
                  <span className="font-mono text-cell text-primary">{f.description}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {inactiveFlags.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <p className="mb-2 font-display text-caps text-muted uppercase tracking-header">
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
      </Section>

      {properties.length > 0 && (
        <Section title="Account Properties">
          <Facts>
            {properties.map((prop) => (
              <Fact
                key={prop.label}
                label={
                  <span className="inline-flex items-center gap-1">
                    {prop.label}
                    {prop.tip && <InfoTip>{prop.tip}</InfoTip>}
                  </span>
                }
              >
                {prop.value}
              </Fact>
            ))}
          </Facts>
        </Section>
      )}
    </div>
  );
}
