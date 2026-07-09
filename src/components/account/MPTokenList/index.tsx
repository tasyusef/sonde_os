import CopyButton from "@/components/shared/CopyButton";

export interface MPToken {
  LedgerEntryType: "MPToken";
  MPTokenIssuanceID: string;
  MPTAmount: string;
  LockedAmount?: string;
  Flags: number;
  index: string;
}

export interface MPTokenIssuance {
  LedgerEntryType: "MPTokenIssuance";
  Issuer: string;
  OutstandingAmount?: string;
  MaximumAmount?: string;
  AssetScale?: number;
  TransferFee?: number;
  MPTokenMetadata?: string;
  Flags: number;
  index: string;
}

function truncateId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 6)}...${id.slice(-6)}` : id;
}

function formatMPTFee(fee: number): string {
  // TransferFee is 0-50000, where 50000 = 50%
  return `${(fee / 1000).toFixed(2)}%`;
}

export default function MPTokenList({
  mpTokens,
  mpTokenIssuances,
}: {
  mpTokens: MPToken[];
  mpTokenIssuances: MPTokenIssuance[];
}) {
  if (mpTokens.length === 0 && mpTokenIssuances.length === 0) {
    return (
      <div className="rounded-2xl shadow-card bg-surface p-8 text-center">
        <p className="font-mono text-body text-muted">No multi-purpose tokens found</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {mpTokens.length > 0 && (
        <div>
          {mpTokenIssuances.length > 0 && (
            <h2 className="mb-3 font-display text-lg font-medium text-primary">
              Held
            </h2>
          )}
          <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
            <table className="w-full">
              <thead>
                <tr className="border-b border-elevated">
                  <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                    Issuance ID
                  </th>
                  <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
                    Amount
                  </th>
                  <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
                    Locked
                  </th>
                </tr>
              </thead>
              <tbody>
                {mpTokens.map((token, i) => (
                  <tr
                    key={token.index || i}
                    className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
                  >
                    <td className="px-4 py-row">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-cell text-primary">{truncateId(token.MPTokenIssuanceID)}</span>
                        <CopyButton text={token.MPTokenIssuanceID} />
                      </span>
                    </td>
                    <td className="px-4 py-row text-right font-mono text-cell text-primary tabular-nums">
                      {BigInt(token.MPTAmount).toLocaleString()}
                    </td>
                    <td className="px-4 py-row text-right font-mono text-cell text-secondary tabular-nums">
                      {token.LockedAmount ? BigInt(token.LockedAmount).toLocaleString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mpTokenIssuances.length > 0 && (
        <div>
          {mpTokens.length > 0 && (
            <h2 className="mb-3 font-display text-lg font-medium text-primary">
              Issued
            </h2>
          )}
          <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
            <table className="w-full">
              <thead>
                <tr className="border-b border-elevated">
                  <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                    Index
                  </th>
                  <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
                    Outstanding
                  </th>
                  <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
                    Maximum
                  </th>
                  <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
                    Transfer Fee
                  </th>
                </tr>
              </thead>
              <tbody>
                {mpTokenIssuances.map((issuance, i) => (
                  <tr
                    key={issuance.index || i}
                    className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
                  >
                    <td className="px-4 py-row">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-cell text-primary">{truncateId(issuance.index)}</span>
                        <CopyButton text={issuance.index} />
                      </span>
                    </td>
                    <td className="px-4 py-row text-right font-mono text-cell text-primary tabular-nums">
                      {issuance.OutstandingAmount ? BigInt(issuance.OutstandingAmount).toLocaleString() : "0"}
                    </td>
                    <td className="px-4 py-row text-right font-mono text-cell text-secondary tabular-nums">
                      {issuance.MaximumAmount ? BigInt(issuance.MaximumAmount).toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-row text-right font-mono text-cell text-secondary tabular-nums">
                      {issuance.TransferFee ? formatMPTFee(issuance.TransferFee) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
