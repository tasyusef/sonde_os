import AddressLink from "@/components/shared/AddressLink";
import Section from "@/components/shared/Section";
import { cell, thClass } from "@/lib/table";
import { cn } from "@/lib/utils";
import { decodeCurrency, dropsToXrp } from "@/lib/xrpl-helpers";
import type { AffectedNodeEntry } from "./types";

interface BalanceChange {
  account: string;
  changes: Array<{
    currency: string;
    issuer?: string;
    value: string; // signed: positive = credit, negative = debit
  }>;
  isFeePayer: boolean;
}

function extractBalanceChanges(
  affectedNodes: AffectedNodeEntry[],
  txAccount: string,
  fee: string,
): BalanceChange[] {
  const balances = new Map<string, Map<string, { currency: string; issuer?: string; value: bigint }>>();

  function addDelta(account: string, currency: string, issuer: string | undefined, delta: bigint) {
    if (delta === 0n) return;
    if (!balances.has(account)) balances.set(account, new Map());
    const acctMap = balances.get(account)!;
    const key = `${currency}:${issuer ?? "XRP"}`;
    const existing = acctMap.get(key);
    if (existing) {
      existing.value += delta;
    } else {
      acctMap.set(key, { currency, issuer, value: delta });
    }
  }

  for (const node of affectedNodes) {
    const created = node.CreatedNode;
    const modified = node.ModifiedNode;
    const deleted = node.DeletedNode;

    if (created?.LedgerEntryType === "AccountRoot") {
      const fields = created.NewFields as Record<string, unknown> | undefined;
      if (fields?.Account && fields?.Balance) {
        addDelta(
          fields.Account as string,
          "XRP",
          undefined,
          BigInt(fields.Balance as string),
        );
      }
    }

    if (modified?.LedgerEntryType === "AccountRoot") {
      const final_ = modified.FinalFields as Record<string, unknown> | undefined;
      const prev = modified.PreviousFields as Record<string, unknown> | undefined;
      if (final_?.Account && prev?.Balance != null) {
        const finalBal = BigInt(final_.Balance as string);
        const prevBal = BigInt(prev.Balance as string);
        addDelta(final_.Account as string, "XRP", undefined, finalBal - prevBal);
      }
    }

    if (deleted?.LedgerEntryType === "AccountRoot") {
      const fields = deleted.FinalFields as Record<string, unknown> | undefined;
      if (fields?.Account && fields?.Balance) {
        addDelta(
          fields.Account as string,
          "XRP",
          undefined,
          -BigInt(fields.Balance as string),
        );
      }
    }

    // RippleState (trust line) balance changes
    const entryType =
      created?.LedgerEntryType ??
      modified?.LedgerEntryType ??
      deleted?.LedgerEntryType;

    if (entryType === "RippleState") {
      const finalFields =
        (created?.NewFields ?? modified?.FinalFields ?? deleted?.FinalFields) as Record<string, unknown> | undefined;
      const prevFields =
        (modified?.PreviousFields) as Record<string, unknown> | undefined;

      if (finalFields?.Balance && typeof finalFields.Balance === "object") {
        const bal = finalFields.Balance as { currency: string; issuer?: string; value: string };
        const highLimit = finalFields.HighLimit as { issuer: string } | undefined;
        const lowLimit = finalFields.LowLimit as { issuer: string } | undefined;

        let finalValue = 0n;
        let prevValue = 0n;

        try {
          // Balance values are decimal strings — scale to avoid floating point
          const parseScaled = (v: string) => {
            const [whole, frac = ""] = v.replace("-", "").split(".");
            const neg = v.startsWith("-");
            const scaled = BigInt(whole) * 1000000000000n + BigInt(frac.padEnd(12, "0").slice(0, 12));
            return neg ? -scaled : scaled;
          };

          finalValue = parseScaled(bal.value);

          if (prevFields?.Balance && typeof prevFields.Balance === "object") {
            prevValue = parseScaled((prevFields.Balance as { value: string }).value);
          } else if (created) {
            prevValue = 0n;
          } else if (deleted) {
            finalValue = 0n;
            prevValue = parseScaled(bal.value);
          }
        } catch {
          // skip this node if parsing fails
          continue;
        }

        const delta = finalValue - prevValue;
        if (delta !== 0n && highLimit?.issuer && lowLimit?.issuer) {
          // Positive balance = low owes high. Delta > 0 means high gained.
          addDelta(highLimit.issuer, bal.currency, lowLimit.issuer, delta);
          addDelta(lowLimit.issuer, bal.currency, highLimit.issuer, -delta);
        }
      }
    }
  }

  let feeBigInt = 0n;
  try { feeBigInt = BigInt(fee); } catch { /* non-integer fee string */ }

  const result: BalanceChange[] = [];
  for (const [account, changes] of balances) {
    const items: BalanceChange["changes"] = [];
    for (const change of changes.values()) {
      if (change.value === 0n) continue;
      if (change.currency === "XRP") {
        // Convert drops to XRP string with sign
        const abs = change.value < 0n ? -change.value : change.value;
        const sign = change.value < 0n ? "-" : "";
        items.push({
          currency: "XRP",
          value: `${sign}${dropsToXrp(abs.toString())}`,
        });
      } else {
        // Token — unscale the 12-decimal precision
        const abs = change.value < 0n ? -change.value : change.value;
        const sign = change.value < 0n ? "-" : "";
        const whole = abs / 1000000000000n;
        const frac = (abs % 1000000000000n).toString().padStart(12, "0").replace(/0+$/, "");
        const display = frac ? `${whole}.${frac}` : whole.toString();
        items.push({
          currency: change.currency,
          issuer: change.issuer,
          value: `${sign}${display}`,
        });
      }
    }
    if (items.length > 0) {
      result.push({
        account,
        changes: items,
        isFeePayer: account === txAccount && feeBigInt > 0n,
      });
    }
  }

  return result;
}

/* ------------------------------------------------------------------ */
/*  Determine display label — SENT, RECEIVED, or generic              */
/* ------------------------------------------------------------------ */

function getChangeType(value: string): "credit" | "debit" {
  return value.startsWith("-") ? "debit" : "credit";
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const TAG = "rounded-tag px-1.5 py-0.5 text-tag font-medium uppercase";

/**
 * Net balance change per account. Mobile-first, same pattern as
 * `EscrowList`:
 *
 *   Mobile (<sm): Account (+ fee payer) | Balance changes
 *   sm+:          # | Type | Account (+ fee payer) | Balance changes
 *
 * Below sm the signed, coloured amount says what the CREDIT/DEBIT tag
 * would. The address is truncated until lg, where the full one fits.
 * From sm each tag and amount line is a 20px box (the tag's `py-0.5`,
 * matched on the amount), so an account's tags line up with its amounts.
 */
export default function BalanceChanges({
  affectedNodes,
  txAccount,
  fee,
  className,
}: {
  affectedNodes: AffectedNodeEntry[];
  txAccount: string;
  fee: string;
  className?: string;
}) {
  const changes = extractBalanceChanges(affectedNodes, txAccount, fee);

  if (changes.length === 0) return null;

  return (
    <Section title="Balance changes" count={changes.length} className={className}>
      <table className="w-full table-fixed">
        <colgroup>
          <col className="hidden sm:table-column sm:w-10" />
          <col className="hidden sm:table-column sm:w-24" />
          <col className="w-auto" />
          <col className="w-[55%] sm:w-[35%]" />
        </colgroup>
        <thead>
          <tr className="border-b border-line">
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
              #
            </th>
            <th scope="col" className={`${thClass} hidden text-left sm:table-cell`}>
              Type
            </th>
            <th scope="col" className={`${thClass} text-left max-sm:pl-0`}>
              Affected account
            </th>
            <th scope="col" className={`${thClass} text-right`}>
              Balance changes
            </th>
          </tr>
        </thead>
        <tbody>
          {changes.map((change, i) => (
            <tr
              key={change.account}
              className="border-b border-line last:border-b-0 hover:bg-row-hover"
            >
              <td className={`${cell} hidden font-mono text-cell text-muted sm:table-cell`}>
                {i + 1}
              </td>
              <td className={`${cell} hidden sm:table-cell`}>
                <div className="flex flex-col items-start gap-1">
                  {change.changes.map((c, j) => {
                    const type = getChangeType(c.value);
                    return (
                      <span
                        key={j}
                        className={cn(
                          TAG,
                          type === "credit" ? "tag-success" : "tag-error",
                        )}
                      >
                        {type === "credit" ? "CREDIT" : "DEBIT"}
                      </span>
                    );
                  })}
                </div>
              </td>
              <td className={`${cell} max-sm:pl-0 max-sm:align-top`}>
                {/* Fee payer sits under the address on phones, beside it from sm. */}
                <div className="flex flex-col items-start gap-1 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
                  <AddressLink address={change.account} className="lg:hidden" />
                  <AddressLink
                    address={change.account}
                    truncate={false}
                    className="hidden lg:inline-block"
                  />
                  {change.isFeePayer && (
                    <span className={cn(TAG, "bg-elevated text-muted")}>FEE PAYER</span>
                  )}
                </div>
              </td>
              <td className={`${cell} text-right max-sm:align-top`}>
                <div className="space-y-1">
                  {change.changes.map((c, j) => {
                    const type = getChangeType(c.value);
                    const absValue = c.value.replace("-", "");
                    return (
                      <div key={j} className="break-words font-mono text-cell sm:py-0.5">
                        <span
                          className={cn(
                            "font-medium tabular-nums",
                            type === "credit" ? "text-success" : "text-error",
                          )}
                        >
                          {type === "credit" ? "+" : "−"}
                          {absValue}
                        </span>{" "}
                        <span className="text-muted">{decodeCurrency(c.currency)}</span>
                      </div>
                    );
                  })}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}
