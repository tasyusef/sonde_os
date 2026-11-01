import { formatScaled } from "@/lib/format";
import { cell, thClass } from "@/lib/table";
import { mptIssuanceId } from "@/lib/token-id";
import { formatPercent, mptFeePercent, parseMptMetadata } from "@/lib/token-info";
import type { MPTokenIssuance } from ".";
import TokenCell from "./TokenCell";

const amountCell = `${cell} break-words text-right align-top font-mono text-cell text-primary tabular-nums`;

/**
 * Issued MPTs, amounts at the issuance's own scale. Mobile: Token |
 * Outstanding (+ maximum, fee); sm+: Token | Outstanding | Maximum |
 * Transfer Fee.
 */
export default function IssuedTable({ issuances }: { issuances: MPTokenIssuance[] }) {
  return (
    <table className="w-full table-fixed">
      <colgroup>
        <col className="w-auto" />
        <col className="w-[44%] sm:w-[24%]" />
        <col className="hidden sm:table-column sm:w-[24%]" />
        <col className="hidden sm:table-column sm:w-[18%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className={`${thClass} text-left`}>
            Token
          </th>
          <th scope="col" className={`${thClass} text-right max-sm:pr-0`}>
            Outstanding
          </th>
          <th scope="col" className={`${thClass} hidden text-right sm:table-cell`}>
            Maximum
          </th>
          <th scope="col" className={`${thClass} hidden text-right sm:table-cell`}>
            Transfer Fee
          </th>
        </tr>
      </thead>
      <tbody>
        {issuances.map((issuance, i) => {
          const scale = issuance.AssetScale ?? 0;
          const max = issuance.MaximumAmount ? formatScaled(BigInt(issuance.MaximumAmount), scale) : null;
          const fee = issuance.TransferFee ? formatPercent(mptFeePercent(issuance.TransferFee)) : null;
          return (
            <tr key={issuance.index || i} className="border-b border-line last:border-b-0 hover:bg-row-hover">
              <td className={`${cell} align-top`}>
                <TokenCell
                  id={mptIssuanceId(issuance.Sequence, issuance.Issuer)}
                  ticker={parseMptMetadata(issuance.MPTokenMetadata)?.ticker}
                />
              </td>
              <td className={`${amountCell} max-sm:pr-0`}>
                {formatScaled(BigInt(issuance.OutstandingAmount ?? "0"), scale)}
                {/* Mobile-only Maximum and Transfer Fee; their own columns from sm. */}
                {max && <span className="mt-0.5 block text-tag text-muted sm:hidden">{max} max</span>}
                {fee && <span className="mt-0.5 block text-tag text-muted sm:hidden">{fee} fee</span>}
              </td>
              <td className={`${amountCell} hidden sm:table-cell`}>{max ?? "—"}</td>
              <td className={`${amountCell} hidden sm:table-cell`}>{fee ?? "—"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
