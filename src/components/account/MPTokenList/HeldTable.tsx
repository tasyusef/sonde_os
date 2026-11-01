import Skeleton from "@/components/shared/Skeleton";
import { useMptIssuance } from "@/hooks/useToken";
import { formatScaled } from "@/lib/format";
import { cell, thClass } from "@/lib/table";
import { parseMptMetadata } from "@/lib/token-info";
import type { MPToken } from ".";
import TokenCell from "./TokenCell";

const amountCell = `${cell} break-words text-right align-top font-mono text-cell text-primary tabular-nums`;

/** Held MPTs. Mobile: Token | Amount (+ locked); sm+: Token | Amount | Locked. */
export default function HeldTable({ tokens }: { tokens: MPToken[] }) {
  return (
    <table className="w-full table-fixed">
      <colgroup>
        <col className="w-auto" />
        <col className="w-[44%] sm:w-[28%]" />
        <col className="hidden sm:table-column sm:w-[28%]" />
      </colgroup>
      <thead>
        <tr className="border-b border-line">
          <th scope="col" className={`${thClass} text-left`}>
            Token
          </th>
          <th scope="col" className={`${thClass} text-right max-sm:pr-0`}>
            Amount
          </th>
          <th scope="col" className={`${thClass} hidden text-right sm:table-cell`}>
            Locked
          </th>
        </tr>
      </thead>
      <tbody>
        {tokens.map((token, i) => (
          <HeldRow key={token.index || i} token={token} />
        ))}
      </tbody>
    </table>
  );
}

/** A held amount is in the issuance's smallest unit, so the row reads
 *  the issuance for its scale (and its ticker) before it can print it. */
function HeldRow({ token }: { token: MPToken }) {
  const { issuance, failed, notFound } = useMptIssuance(token.MPTokenIssuanceID);
  const loading = !issuance && !failed && !notFound;
  const scale = issuance?.AssetScale ?? 0;
  const amount = (raw: string | undefined) =>
    loading ? <Skeleton className="ml-auto h-4 w-20" /> : issuance && raw ? formatScaled(BigInt(raw), scale) : "—";
  const locked = token.LockedAmount && token.LockedAmount !== "0" ? token.LockedAmount : undefined;
  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-row-hover">
      <td className={`${cell} align-top`}>
        <TokenCell id={token.MPTokenIssuanceID} ticker={parseMptMetadata(issuance?.MPTokenMetadata)?.ticker} />
      </td>
      <td className={`${amountCell} max-sm:pr-0`}>
        {amount(token.MPTAmount ?? "0")}
        {/* Mobile-only Locked; its own column from sm. */}
        {locked && issuance && (
          <span className="mt-0.5 block text-tag text-muted sm:hidden">{amount(locked)} locked</span>
        )}
      </td>
      <td className={`${amountCell} hidden sm:table-cell`}>{locked ? amount(locked) : "—"}</td>
    </tr>
  );
}
