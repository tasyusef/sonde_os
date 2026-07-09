import "server-only";
import { xrplClient } from "./xrpl-client";
import type { AccountLinesResponse, GatewayBalancesResponse } from "@/types/xrpl-responses";
import type { XrplClient } from "./xrpl-client";
import logger from "@/lib/logger";

interface TopHoldersResult {
  holders: Array<{ address: string; balance: number }>;
  totalSupply: number;
  /** Total number of accounts holding a positive balance of this token */
  holderCount: number;
  /** Total number of trust lines scanned (including zero/frozen balances) */
  trustlineCount: number;
}

/**
 * Fetch the top 10 holders for a token by paginating account_lines on the issuer.
 *
 * XRPL perspective: from the issuer's side, trust line balances are negative
 * (the issuer "owes" holders). We negate them to get positive holder balances.
 *
 * Uses gateway_balances for total supply, falls back to summing all balances.
 */
export async function fetchTopHolders(
  currency: string,
  issuer: string,
  /** Optional client override — background jobs should pass ingestionClient
   *  to avoid competing with page-serving requests. */
  client?: XrplClient,
): Promise<TopHoldersResult> {
  const ws = client ?? xrplClient;
  // 1. Get total supply via gateway_balances (retries on slowDown)
  let totalSupply = 0;
  try {
    const gbResult = (await ws.sendWithRetry({
      command: "gateway_balances",
      account: issuer,
      ledger_index: "validated",
    })) as GatewayBalancesResponse;
    const obligation = gbResult?.obligations?.[currency];
    if (obligation) {
      totalSupply = parseFloat(obligation);
    }
  } catch {
    // Will compute from sum of balances below
  }

  // 2. Paginate account_lines to get all holders of this currency
  //    Uses sendWithRetry so slowDown triggers backoff instead of failure
  const allHolders: Array<{ address: string; balance: number }> = [];
  let trustlineCount = 0;
  let marker: unknown = undefined;
  let pages = 0;
  const MAX_PAGES = 50; // Safety limit (~20,000 trust lines)

  do {
    try {
      const result = (await ws.sendWithRetry({
        command: "account_lines",
        account: issuer,
        ledger_index: "validated",
        limit: 400,
        ...(marker ? { marker } : {}),
      })) as AccountLinesResponse;

      if (result.lines) {
        for (const line of result.lines) {
          if (line.currency !== currency) continue;
          trustlineCount++;
          // Issuer-side balances are negative; negate for holder perspective
          const balance = -parseFloat(line.balance);
          if (balance > 0) {
            allHolders.push({ address: line.account, balance });
          }
        }
      }

      marker = result.marker;
      pages++;

      // Small delay between pages to be rate-limit friendly
      if (marker && pages < MAX_PAGES) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (err) {
      logger.warn({ err }, `[holder-data] Error on page ${pages + 1} for ${issuer}/${currency}`);
      break; // Keep partial results
    }
  } while (marker && pages < MAX_PAGES);

  // 3. If gateway_balances failed, compute total from all balances
  if (totalSupply <= 0 && allHolders.length > 0) {
    totalSupply = allHolders.reduce((sum, h) => sum + h.balance, 0);
  }

  // 4. Sort descending, take top 10
  allHolders.sort((a, b) => b.balance - a.balance);
  const top10 = allHolders.slice(0, 10);

  return { holders: top10, totalSupply, holderCount: allHolders.length, trustlineCount };
}
