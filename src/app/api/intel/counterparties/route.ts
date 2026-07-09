import { NextResponse, type NextRequest } from "next/server";
import { getAccountCounterparties } from "@/lib/clickhouse-queries";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import { LRUCache, singleflight } from "@/lib/cache";
import logger from "@/lib/logger";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-counterparties", 20);
const cpCache = new LRUCache<unknown>(50, 30_000);
const log = logger.child({ module: "api/intel/counterparties" });

interface Counterparty {
  address: string;
  txCount: number;
  type: string;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }

  const account = request.nextUrl.searchParams.get("account");
  if (!account || !XRPL_ADDRESS_RE.test(account)) {
    return NextResponse.json({ error: "Valid account address required" }, { status: 400 });
  }

  try {
    const counterparties = await singleflight<Counterparty[]>(
      `counterparties:${account}`,
      cpCache,
      async () => {
        // `getAccountCounterparties` is the canonical helper —
        // partition-pruned PK lookup against `mv_account_counterparty_daily`,
        // self-edge filter applied, returns the unified shape consumed
        // by both this route and `intel-graph-features.ts`.
        const rows = await getAccountCounterparties(account, { limit: 8 });
        return rows.map((r) => ({
          address: r.address,
          txCount: r.txCount,
          // The legacy API contract here uses uppercase enum strings.
          type: r.type === "payment" ? "PAYMENT" : "DEX_TRADE",
        }));
      },
    );

    return NextResponse.json({ account, counterparties });
  } catch (err) {
    log.error({ err, account }, "counterparties query failed");
    return NextResponse.json(
      { error: "Failed to query counterparties" },
      { status: 500 },
    );
  }
}
