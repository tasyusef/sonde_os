/**
 * Mock-data middleware.
 *
 * When MOCK_DATA=true, intercepts all /api/* requests and returns realistic
 * mock JSON so the UI renders without Postgres, Neo4j, ClickHouse, or XRPL.
 *
 * The SSE stream (/api/stream) gets a special handler that sends one snapshot
 * then closes — enough for LiveDataProvider to hydrate the UI.
 */

import { NextResponse, type NextRequest } from "next/server";
import {
  MOCK_DEX_VOLUME,
  MOCK_FEE_BURN,
  MOCK_TX_VOLUME,
  MOCK_CORRIDORS,
  MOCK_NFT_ACTIVITY,
  MOCK_TOKEN_MOVERS,
  MOCK_AMM_REVENUE,
  MOCK_TOP_TRADERS,
  MOCK_ACTIVE_WALLETS,
  MOCK_XRP_SUPPLY,
  MOCK_NETWORK_GROWTH,
  MOCK_TOKEN_VELOCITY,
  MOCK_DEX_TVL,
  MOCK_TOKEN_LIST,
  getMockOhlc,
  MOCK_TOKEN_HOLDERS,
  MOCK_TOKEN_PAIRS,
  MOCK_TOKEN_VOLUME_RANKINGS,
  MOCK_NFT_COLLECTIONS,
  MOCK_NFT_MARKETPLACES,
  MOCK_AUTH_ME,
  getMockPriceHistory,
  getMockSSESnapshot,
  MOCK_AMENDMENTS,
  MOCK_INTEL_OVERVIEW,
  MOCK_INTEL_HEALTH,
  MOCK_INTEL_INGESTION_STATUS,
  MOCK_INGESTION_STATUS,
  MOCK_SEARCH,
  MOCK_TOKEN_PRICES,
  MOCK_REALIZED_HISTORY,
  MOCK_CORRELATION,
  MOCK_PORTFOLIO_DEBUG,
  getMockTrace,
  getMockConnections,
  getMockRisk,
  getMockProfile,
  getMockQuery,
} from "@/lib/mock-data";

/* ------------------------------------------------------------------ */
/*  Route → mock response map                                          */
/* ------------------------------------------------------------------ */

type MockHandler = (req: NextRequest) => Response | NextResponse | Promise<Response | NextResponse>;

function json(data: unknown): NextResponse {
  return NextResponse.json(data);
}

/**
 * Map of pathname prefixes to mock handlers.
 * Order matters — more specific paths first.
 */
const MOCK_ROUTES: [string, MockHandler][] = [
  // ── Analytics ──
  ["/api/analytics/dex-volume", () => json(MOCK_DEX_VOLUME)],
  ["/api/analytics/fee-burn", () => json(MOCK_FEE_BURN)],
  ["/api/analytics/tx-volume", () => json(MOCK_TX_VOLUME)],
  ["/api/analytics/corridors", () => json(MOCK_CORRIDORS)],
  ["/api/analytics/nft-activity", () => json(MOCK_NFT_ACTIVITY)],
  ["/api/analytics/token-movers", () => json(MOCK_TOKEN_MOVERS)],
  ["/api/analytics/amm-revenue", () => json(MOCK_AMM_REVENUE)],
  ["/api/analytics/top-traders", () => json(MOCK_TOP_TRADERS)],
  ["/api/analytics/active-wallets", () => json(MOCK_ACTIVE_WALLETS)],
  ["/api/analytics/xrp-supply", () => json(MOCK_XRP_SUPPLY)],
  ["/api/analytics/network-growth", () => json(MOCK_NETWORK_GROWTH)],
  ["/api/analytics/token-velocity", () => json(MOCK_TOKEN_VELOCITY)],
  ["/api/analytics/dex-tvl", () => json(MOCK_DEX_TVL)],

  // ── Tokens ──
  ["/api/tokens/list", () => json(MOCK_TOKEN_LIST)],
  ["/api/tokens/ohlc", () => json(getMockOhlc())],
  ["/api/tokens/holders", () => json(MOCK_TOKEN_HOLDERS)],

  // ── Rankings ──
  ["/api/rankings/token-pairs", () => json(MOCK_TOKEN_PAIRS)],
  ["/api/rankings/token-volume", () => json(MOCK_TOKEN_VOLUME_RANKINGS)],
  ["/api/rankings/nft-collections", () => json(MOCK_NFT_COLLECTIONS)],
  ["/api/rankings/nft-marketplaces", () => json(MOCK_NFT_MARKETPLACES)],

  // ── Auth ──
  ["/api/auth/me", () => json(MOCK_AUTH_ME)],
  ["/api/auth/logout", () => json({ ok: true })],
  ["/api/auth/xaman/status", () => json({ status: "pending" })],
  ["/api/auth/xaman", () => json({ uuid: "mock-uuid", qrUrl: "", websocketUrl: "" })],
  ["/api/auth/joey", () => json({ status: "resolved", address: "rPEPPER7kfTD9w2To4CQk6UCfuHM9c6GDY" })],

  // ── Price ──
  ["/api/price-history", (req) => {
    const days = parseInt(req.nextUrl.searchParams.get("days") ?? "30", 10) || 30;
    return json(getMockPriceHistory(days));
  }],

  // ── Account ──
  ["/api/account/token-prices", () => json(MOCK_TOKEN_PRICES)],

  // ── Amendments ──
  ["/api/amendments", () => json(MOCK_AMENDMENTS)],

  // ── Intel ──
  ["/api/intel/overview", () => json(MOCK_INTEL_OVERVIEW)],
  ["/api/intel/health", () => json(MOCK_INTEL_HEALTH)],
  ["/api/intel/ingestion/status", () => json(MOCK_INTEL_INGESTION_STATUS)],
  ["/api/intel/trace", async (req) => {
    const body = await req.json().catch(() => ({}));
    return json(getMockTrace(body.account));
  }],
  ["/api/intel/connections", async (req) => {
    const body = await req.json().catch(() => ({}));
    return json(getMockConnections(body.source, body.target));
  }],
  ["/api/intel/profile", (req) => {
    const account = req.nextUrl.searchParams.get("account");
    return json(getMockProfile(account ?? undefined));
  }],
  ["/api/intel/risk", (req) => {
    const account = req.nextUrl.searchParams.get("account");
    return json(getMockRisk(account ?? undefined));
  }],
  ["/api/intel/query", async (req) => {
    const body = await req.json().catch(() => ({}));
    return json(getMockQuery(body.question));
  }],

  // ── Ingestion ──
  ["/api/ingestion/status", () => json(MOCK_INGESTION_STATUS)],

  // ── Search ──
  ["/api/search", () => json(MOCK_SEARCH)],

  // ── Portfolio (extras not covered by MOCK_PORTFOLIO) ──
  ["/api/portfolio/realized-history", () => json(MOCK_REALIZED_HISTORY)],
  ["/api/portfolio/correlation", () => json(MOCK_CORRELATION)],
  ["/api/portfolio/debug", () => json(MOCK_PORTFOLIO_DEBUG)],
  ["/api/portfolio/activity/export", () => new Response("date,type,hash,amount,fee\n", {
    headers: { "Content-Type": "text/csv" },
  })],

  // ── SSE Stream ──
  ["/api/stream", () => {
    const snapshot = getMockSSESnapshot();
    const encoder = new TextEncoder();
    const lines: string[] = [];

    const emit = (event: string, data: unknown) => {
      lines.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    emit("ledger", snapshot.ledger);
    emit("transactions", { txs: snapshot.transactions, total: snapshot.txCount });
    emit("stats", snapshot.stats);
    emit("fee", snapshot.fee);
    emit("health", snapshot.health);
    emit("txDistribution", snapshot.txDistribution);
    emit("price", snapshot.price);
    emit("recentMints", snapshot.recentMints);

    const body = encoder.encode(lines.join(""));

    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  }],
];

/* ------------------------------------------------------------------ */
/*  Middleware entry                                                    */
/* ------------------------------------------------------------------ */

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Set pathname header for server components (used by PageViewTracker)
  const response = NextResponse.next();
  response.headers.set("x-pathname", pathname);

  // Mock data: never in production, only when explicitly enabled
  if (process.env.NODE_ENV === "production") return response;
  if (process.env.MOCK_DATA !== "true") return response;

  // Only intercept API routes for mocking
  if (!pathname.startsWith("/api/")) return response;

  // Skip routes that the portfolio mock flag handles natively
  // (those routes already check MOCK_PORTFOLIO themselves)
  const PORTFOLIO_NATIVE = [
    "/api/portfolio/current",
    "/api/portfolio/history",
    "/api/portfolio/tokens",
    "/api/portfolio/nfts",
    "/api/portfolio/amm",
    "/api/portfolio/activity",
  ];
  if (PORTFOLIO_NATIVE.some((p) => pathname === p)) {
    return NextResponse.next();
  }

  // Find matching mock handler
  for (const [prefix, handler] of MOCK_ROUTES) {
    if (pathname === prefix || pathname.startsWith(prefix + "/")) {
      return handler(request);
    }
  }

  // Unmatched API routes fall through to real handlers (will likely 500
  // without DB, but at least they won't block non-DB routes like
  // /api/nft-image or /api/nft-metadata which proxy external URLs).
  return NextResponse.next();
}

// Match API routes (for mocking) and page routes (for pageview tracking header).
// Excludes _next, static assets, and favicon.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)", "/api/:path*"],
};
