import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { readOnlyQuery } from "@/lib/clickhouse-client";
import { LRUCache } from "@/lib/cache";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-watchlist-status", 20);

interface AddressStatus {
  address: string;
  lastActive: string | null;
  riskLevel: "low" | "medium" | "high" | "unknown";
  txCount24h: number;
}

// Per-address 5-minute cache — allows partial cache hits across batches
const statusCache = new LRUCache<AddressStatus>(200, 5 * 60_000);

/** POST — batch status for watchlist addresses */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const session = await getSession(await cookies());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { addresses: string[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { addresses } = body;
  if (!Array.isArray(addresses) || addresses.length === 0 || addresses.length > 100) {
    return NextResponse.json({ error: "addresses must be an array of 1-100 items" }, { status: 400 });
  }

  // Split into cached and uncached
  const results: AddressStatus[] = [];
  const uncached: string[] = [];

  for (const addr of addresses) {
    if (typeof addr !== "string") continue;
    const cached = statusCache.get(addr);
    if (cached) {
      results.push(cached);
    } else {
      uncached.push(addr);
    }
  }

  if (uncached.length > 0) {
    // Fetch last activity from ClickHouse
    const activityMap = new Map<string, { lastActive: string; txCount24h: number }>();
    try {
      const rows = await readOnlyQuery(
        `SELECT
           account,
           max(timestamp) AS last_active,
           countIf(timestamp > now() - INTERVAL 24 HOUR) AS tx_count_24h
         FROM transactions
         WHERE account IN ({addresses:Array(String)})
         GROUP BY account`,
        { addresses: uncached },
      );
      for (const row of rows) {
        const r = row as { account: string; last_active: string; tx_count_24h: number };
        activityMap.set(r.account, {
          lastActive: r.last_active,
          txCount24h: Number(r.tx_count_24h) || 0,
        });
      }
    } catch {
      // ClickHouse unavailable — proceed with nulls
    }

    // Fetch risk level via CH degree (simple heuristic: high degree =
    // higher risk). UNION ALL counts edges across both source tables;
    // IN-filter on the address list is bloom-filter-indexed on
    // from_account / to_account / taker / maker so this is fast even
    // without a time bound.
    const riskMap = new Map<string, "low" | "medium" | "high">();
    try {
      const rows = await readOnlyQuery<{ address: string; degree: string }>(
        `SELECT account AS address, count() AS degree
         FROM (
           SELECT from_account AS account FROM value_transfer_events
             WHERE from_account IN ({addresses:Array(String)})
           UNION ALL
           SELECT to_account AS account FROM value_transfer_events
             WHERE to_account IN ({addresses:Array(String)})
           UNION ALL
           SELECT taker AS account FROM dex_trades
             WHERE taker IN ({addresses:Array(String)})
           UNION ALL
           SELECT maker AS account FROM dex_trades
             WHERE maker IN ({addresses:Array(String)})
         )
         GROUP BY account`,
        { addresses: uncached },
      );
      for (const r of rows) {
        const deg = Number(r.degree) || 0;
        riskMap.set(r.address, deg > 500 ? "high" : deg > 50 ? "medium" : "low");
      }
    } catch {
      // CH unavailable — proceed with "unknown"
    }

    for (const addr of uncached) {
      const activity = activityMap.get(addr);
      const status: AddressStatus = {
        address: addr,
        lastActive: activity?.lastActive ?? null,
        riskLevel: riskMap.get(addr) ?? "unknown",
        txCount24h: activity?.txCount24h ?? 0,
      };
      statusCache.set(addr, status);
      results.push(status);
    }
  }

  return NextResponse.json({ statuses: results });
}
