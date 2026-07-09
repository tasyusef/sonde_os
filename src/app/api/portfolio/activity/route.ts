import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { xrplClient } from "@/lib/xrpl-client";
import { MOCK_ACTIVITY } from "@/lib/mock-portfolio";
import type { AccountTxResult } from "@/types/xrpl";
import logger from "@/lib/logger";

const DEFAULT_LIMIT = 50;
const MAX_PAGES = 10; // safety limit: 10 pages × 20 txns = 200 max per request

/**
 * GET /api/portfolio/activity?limit=50&marker=<json>&type=Payment,OfferCreate
 * Returns paginated transaction history for the authenticated user.
 */
export async function GET(request: Request) {
  if (process.env.MOCK_PORTFOLIO === "true") {
    const url = new URL(request.url);
    const typeFilter = url.searchParams.get("type");
    const markerParam = url.searchParams.get("marker");

    let txns = MOCK_ACTIVITY.transactions;
    if (typeFilter) {
      const types = new Set(typeFilter.split(","));
      txns = txns.filter((t) => types.has(t.tx.TransactionType as string));
    }

    // Simulate pagination: first page = first 5, second page = rest
    const pageSize = 5;
    const offset = markerParam === "page2" ? pageSize : 0;
    const page = txns.slice(offset, offset + pageSize);
    const hasMore = offset + pageSize < txns.length;

    return NextResponse.json({
      transactions: page,
      marker: hasMore ? "page2" : null,
      hasMore,
    });
  }

  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const address = session.address;
  const url = new URL(request.url);
  const parsed = parseInt(url.searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const limit = Math.min(
    Number.isFinite(parsed) ? parsed : DEFAULT_LIMIT,
    200,
  );
  const markerParam = url.searchParams.get("marker");
  const typeFilter = url.searchParams.get("type");
  const types = typeFilter ? new Set(typeFilter.split(",")) : null;

  let marker: unknown;
  if (markerParam) {
    try {
      const parsed = JSON.parse(markerParam);
      if (typeof parsed === "object" && parsed !== null && "ledger" in parsed && "seq" in parsed) {
        marker = parsed;
      } else {
        return NextResponse.json({ error: "Invalid marker shape" }, { status: 400 });
      }
    } catch {
      return NextResponse.json({ error: "Invalid marker parameter" }, { status: 400 });
    }
  }

  try {
    const collected: AccountTxResult["transactions"] = [];
    let pages = 0;
    let nextMarker: unknown = undefined;

    while (collected.length < limit && pages < MAX_PAGES) {
      const result = (await xrplClient.getAccountTx(
        address,
        marker,
      )) as AccountTxResult;

      const txns = result.transactions ?? [];
      if (txns.length === 0) break;

      // Filter by type if requested
      for (const txn of txns) {
        const txType = (txn.tx as Record<string, unknown>)
          .TransactionType as string;
        if (types && !types.has(txType)) continue;
        collected.push(txn);
        if (collected.length >= limit) break;
      }

      nextMarker = result.marker;
      marker = nextMarker;
      pages++;

      if (!nextMarker) break;
    }

    return NextResponse.json({
      transactions: collected.slice(0, limit),
      marker: nextMarker ? JSON.stringify(nextMarker) : null,
      hasMore: !!nextMarker,
    });
  } catch (err) {
    if (err instanceof Response) return err;
    logger.error({ err }, "[api/portfolio/activity] Error");
    return NextResponse.json(
      { error: "Failed to fetch activity" },
      { status: 500 },
    );
  }
}
