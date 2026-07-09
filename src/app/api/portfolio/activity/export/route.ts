import { cookies } from "next/headers";
import { requireTier } from "@/lib/subscription";
import { xrplClient } from "@/lib/xrpl-client";
import { dropsToXrp, XRPL_EPOCH } from "@/lib/xrpl-helpers";
import type { AccountTxResult } from "@/types/xrpl";
import logger from "@/lib/logger";
const MAX_TXNS = 1000;
const MAX_PAGES = 50;

function rippleTimeToISO(rippleTime: number): string {
  return new Date((rippleTime + XRPL_EPOCH) * 1000).toISOString();
}

function escapeCSV(value: string): string {
  // SECURITY: prefix formula-trigger characters with a leading
  // apostrophe so attacker-controlled cell values (memos, currency
  // tags, addresses that survive into a victim's CSV) can't ship Excel
  // formula payloads like `=cmd|'/c calc'!A0` or
  // `=HYPERLINK("//evil")` when the file is opened in Excel/Sheets.
  // Leading single-quote tells the spreadsheet to render the value as
  // text. Apply BEFORE the comma/quote/newline escaping below.
  const needsFormulaGuard = value.length > 0 && /^[=+\-@\t\r]/.test(value);
  const guarded = needsFormulaGuard ? `'${value}` : value;

  if (guarded.includes(",") || guarded.includes('"') || guarded.includes("\n")) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

/**
 * GET /api/portfolio/activity/export
 * Streams all transactions as a CSV download. Pro-only.
 *
 * The dashboard's whole portfolio surface is documented as Pro per
 * `CLAUDE.md` — this route is the one that wasn't gated when the
 * feature-gating sweep ran. requireTier throws a Response on
 * unauthorized / non-pro; the catch below relays it.
 */
export async function GET() {
  const cookieStore = await cookies();
  let address: string;
  try {
    const tierSession = await requireTier(cookieStore, "pro");
    address = tierSession.address;
  } catch (resp) {
    if (resp instanceof Response) return resp;
    throw resp;
  }

  try {
    // Collect all transactions (up to MAX_TXNS)
    const allTxns: AccountTxResult["transactions"] = [];
    let marker: unknown = undefined;
    let pages = 0;

    while (allTxns.length < MAX_TXNS && pages < MAX_PAGES) {
      try {
        const result = (await xrplClient.getAccountTx(
          address,
          marker,
        )) as AccountTxResult;

        const txns = result.transactions ?? [];
        if (txns.length === 0) break;

        allTxns.push(...txns);
        marker = result.marker;
        pages++;

        if (!marker) break;
      } catch (err) {
    if (err instanceof Response) return err;
        logger.warn({ err }, `[api/portfolio/activity/export] Error on page ${pages + 1} for ${address}`);
        break; // Keep partial results
      }
    }

    // Build CSV
    const header = "Date,Type,Hash,From,To,Amount,Currency,Fee (XRP),Status";
    const rows = allTxns.map((item) => {
      const tx = item.tx as Record<string, unknown>;
      const meta = item.meta as Record<string, unknown>;

      const date = typeof tx.date === "number" ? rippleTimeToISO(tx.date) : "";
      const type = (tx.TransactionType as string) ?? "";
      const hash = (tx.hash as string) ?? "";
      const from = (tx.Account as string) ?? "";
      const to = (tx.Destination as string) ?? "";
      const result = (meta.TransactionResult as string) ?? "";
      const fee = typeof tx.Fee === "string" ? dropsToXrp(tx.Fee) : "0";

      // Amount
      const amount = tx.Amount;
      let amountStr = "";
      let currency = "XRP";
      if (typeof amount === "string") {
        amountStr = dropsToXrp(amount);
      } else if (typeof amount === "object" && amount !== null) {
        const tokenAmt = amount as { value?: string; currency?: string };
        amountStr = tokenAmt.value ?? "0";
        currency = tokenAmt.currency ?? "Unknown";
      }

      return [date, type, hash, from, to, amountStr, currency, fee, result]
        .map(escapeCSV)
        .join(",");
    });

    const csv = [header, ...rows].join("\n");
    const truncated = address.slice(0, 8);
    const dateStr = new Date().toISOString().slice(0, 10);

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="sonde-activity-${truncated}-${dateStr}.csv"`,
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/portfolio/activity/export] Error");
    return new Response("Failed to export activity", { status: 500 });
  }
}
