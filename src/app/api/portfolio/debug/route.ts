import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { xrplClient } from "@/lib/xrpl-client";
import { getXrpPrice } from "@/lib/price-data";
import { dropsToXrp } from "@/lib/xrpl-helpers";

/**
 * GET /api/portfolio/debug
 * Step-by-step diagnostic for portfolio data fetching.
 * Returns which steps pass/fail so we can isolate the issue.
 * Only available in development — blocked in production.
 */
export async function GET() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not available" }, { status: 404 });
  }

  const steps: Record<string, unknown> = {};

  // 1. Auth
  try {
    const cookieStore = await cookies();
    const session = await getSession(cookieStore);
    if (!session) {
      return NextResponse.json({ error: "Not authenticated", steps }, { status: 401 });
    }
    steps.auth = { ok: true, address: session.address };
    const address = session.address;

    // 2. XRP Price
    try {
      const priceData = await getXrpPrice();
      steps.price = { ok: true, price: priceData.price };
    } catch (err) {
      steps.price = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    // 3. Account Info
    try {
      const info = await xrplClient.getAccountInfo(address);
      const balance = dropsToXrp((info as { account_data: { Balance: string } }).account_data.Balance);
      steps.accountInfo = { ok: true, xrpBalance: parseFloat(balance) };
    } catch (err) {
      steps.accountInfo = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    // 4. Account Objects (first page only)
    try {
      const result = await xrplClient.getAccountObjects(address, undefined, undefined) as {
        account_objects: Record<string, unknown>[];
        marker?: unknown;
      };
      const types = (result.account_objects ?? []).map((o) => o.LedgerEntryType);
      const trustLines = types.filter((t) => t === "RippleState").length;
      steps.accountObjects = {
        ok: true,
        count: result.account_objects?.length ?? 0,
        trustLines,
        hasMore: !!result.marker,
      };
    } catch (err) {
      steps.accountObjects = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    // 5. Account NFTs (first page only)
    try {
      const result = await xrplClient.getAccountNFTs(address, undefined) as {
        account_nfts: unknown[];
        marker?: unknown;
      };
      steps.accountNFTs = {
        ok: true,
        count: result.account_nfts?.length ?? 0,
        hasMore: !!result.marker,
      };
    } catch (err) {
      steps.accountNFTs = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    return NextResponse.json({ steps });
  } catch (err) {
    steps.fatal = { error: err instanceof Error ? err.message : String(err) };
    return NextResponse.json({ steps }, { status: 500 });
  }
}
