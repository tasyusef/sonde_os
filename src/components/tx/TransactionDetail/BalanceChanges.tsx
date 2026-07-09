import AddressLink from "@/components/shared/AddressLink";
import { dropsToXrp } from "@/lib/xrpl-helpers";
import type { AffectedNodeEntry } from "./index";

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

export default function BalanceChanges({
  affectedNodes,
  txAccount,
  fee,
}: {
  affectedNodes: AffectedNodeEntry[];
  txAccount: string;
  fee: string;
}) {
  const changes = extractBalanceChanges(affectedNodes, txAccount, fee);

  if (changes.length === 0) return null;

  return (
    <div className="overflow-hidden rounded-2xl shadow-card bg-surface">
      <div className="border-b border-elevated px-4 py-2.5">
        <h2 className="font-display text-body font-semibold text-primary">
          Balance changes
        </h2>
      </div>
      {/* Desktop / tablet: standard table layout. Mobile: cards stacked
          vertically (table-row chrome doesn't fit a 375px viewport when
          you're showing a full r-address + tags + signed amounts). */}
      <div className="hidden sm:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-elevated">
              <th scope="col" className="w-10 px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                #
              </th>
              <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                Type
              </th>
              <th scope="col" className="px-4 py-row text-left font-display text-label font-medium uppercase tracking-header text-muted">
                Affected account
              </th>
              <th scope="col" className="px-4 py-row text-right font-display text-label font-medium uppercase tracking-header text-muted">
                Balance changes
              </th>
            </tr>
          </thead>
          <tbody>
            {changes.map((change, i) => (
              <tr
                key={change.account}
                className="border-b border-elevated last:border-b-0 transition-colors hover:bg-row-hover"
              >
                <td className="px-4 py-row font-mono text-cell text-muted">
                  {i + 1}
                </td>
                <td className="px-4 py-row">
                  {change.changes.map((c, j) => {
                    const type = getChangeType(c.value);
                    return (
                      <span
                        key={j}
                        className={`inline-block rounded-tag px-1.5 py-0.5 text-tag font-medium uppercase ${
                          type === "credit"
                            ? "bg-success/10 text-success"
                            : "bg-error/10 text-error"
                        }`}
                      >
                        {type === "credit" ? "CREDIT" : "DEBIT"}
                      </span>
                    );
                  })}
                </td>
                <td className="px-4 py-row">
                  <span className="flex items-center gap-2">
                    <AddressLink address={change.account} truncate={false} />
                    {change.isFeePayer && (
                      <span className="rounded-tag bg-elevated px-1.5 py-0.5 text-tag font-medium text-muted uppercase">
                        FEE PAYER
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-row text-right">
                  {change.changes.map((c, j) => {
                    const type = getChangeType(c.value);
                    const absValue = c.value.replace("-", "");
                    return (
                      <div key={j} className="flex items-center justify-end gap-1">
                        <span
                          className={`font-mono text-cell font-medium tabular-nums ${
                            type === "credit" ? "text-success" : "text-error"
                          }`}
                        >
                          {type === "credit" ? "+" : "−"}{absValue}
                        </span>
                        <span className="font-mono text-cell text-muted">
                          {c.currency}
                        </span>
                      </div>
                    );
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card layout */}
      <div className="sm:hidden">
        {changes.map((change, i) => (
          <div
            key={change.account}
            className="border-b border-elevated px-4 py-3 last:border-b-0"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-label text-muted">#{i + 1}</span>
              {change.isFeePayer && (
                <span className="rounded-tag bg-elevated px-1.5 py-0.5 text-tag font-medium uppercase text-muted">
                  FEE PAYER
                </span>
              )}
            </div>
            <div className="mt-1.5">
              <AddressLink address={change.account} truncate={false} />
            </div>
            <div className="mt-2 space-y-1">
              {change.changes.map((c, j) => {
                const type = getChangeType(c.value);
                const absValue = c.value.replace("-", "");
                return (
                  <div key={j} className="flex items-center justify-between gap-2">
                    <span
                      className={`rounded-tag px-1.5 py-0.5 text-tag font-medium uppercase ${
                        type === "credit"
                          ? "bg-success/10 text-success"
                          : "bg-error/10 text-error"
                      }`}
                    >
                      {type === "credit" ? "CREDIT" : "DEBIT"}
                    </span>
                    <span className="flex items-center gap-1">
                      <span
                        className={`font-mono text-cell font-medium tabular-nums ${
                          type === "credit" ? "text-success" : "text-error"
                        }`}
                      >
                        {type === "credit" ? "+" : "−"}{absValue}
                      </span>
                      <span className="font-mono text-cell text-muted">
                        {c.currency}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
