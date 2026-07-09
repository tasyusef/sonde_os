import "server-only";
import { eq, and, gte, desc, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { subscriptions, aiUsage } from "@/db/schema";
import { getSession } from "./auth";
import { LRUCache } from "./cache";
import type { NextRequest } from "next/server";

// ── Types ──

export interface Subscription {
  tier: "free" | "pro";
  status: "active" | "canceled" | "past_due" | "expired" | null;
  periodEnd: Date | null;
  paymentMethod: "xrp" | "rlusd" | "stripe" | null;
  cancelAtPeriodEnd: boolean;
}

type Tier = "pro";

/** Crypto subs get this many days after expiry with features still accessible. */
export const GRACE_PERIOD_DAYS = 3;

// ── Subscription cache (30s TTL, same as rankings) ──

const subscriptionCache = new LRUCache<Subscription>(200, 30_000);

export function invalidateSubscriptionCache(address: string): void {
  subscriptionCache.delete(address);
}

// ── Whitelist ──

/** Addresses in WHITELISTED_WALLETS get pro access without a subscription. */
const whitelistedWallets = new Set(
  (process.env.WHITELISTED_WALLETS ?? "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean),
);

const WHITELISTED_SUB: Subscription = {
  tier: "pro",
  status: "active",
  periodEnd: null,
  paymentMethod: null,
  cancelAtPeriodEnd: false,
};

// ── Core lookup ──

/**
 * Returns the most recent subscription for an address.
 * Whitelisted wallets always get pro.
 * Active subscriptions return the active row.
 * Recently expired subscriptions return the expired row WITH ORIGINAL TIER
 * (not "free") — critical for grace period check in requireTier().
 * Users with no subscription return { tier: "free", status: null, ... }.
 */
export async function getSubscription(address: string): Promise<Subscription> {
  if (whitelistedWallets.has(address)) return WHITELISTED_SUB;

  const cached = subscriptionCache.get(address);
  if (cached) return cached;

  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userAddress, address))
    .orderBy(desc(subscriptions.currentPeriodEnd))
    .limit(1);

  if (rows.length === 0) {
    const free: Subscription = {
      tier: "free",
      status: null,
      periodEnd: null,
      paymentMethod: null,
      cancelAtPeriodEnd: false,
    };
    subscriptionCache.set(address, free);
    return free;
  }

  const row = rows[0];
  // Any legacy "pro_ai" rows are treated as "pro" (migration also rewrites them).
  const normalizedTier: Subscription["tier"] =
    row.tier === "pro" || row.tier === "pro_ai" ? "pro" : "free";
  const sub: Subscription = {
    tier: normalizedTier,
    status: row.status as Subscription["status"],
    periodEnd: row.currentPeriodEnd,
    paymentMethod: row.paymentMethod as Subscription["paymentMethod"],
    cancelAtPeriodEnd: row.cancelAtPeriodEnd ?? false,
  };
  subscriptionCache.set(address, sub);
  return sub;
}

// ── Tier helpers ──

function isInGracePeriod(sub: Subscription, requiredTier: Tier): boolean {
  return (
    sub.status === "expired" &&
    sub.paymentMethod !== "stripe" &&
    sub.tier === requiredTier &&
    sub.periodEnd !== null &&
    sub.periodEnd > new Date(Date.now() - GRACE_PERIOD_DAYS * 86_400_000)
  );
}

// ── Guards ──

/**
 * Non-throwing tier check for server components — returns the user's
 * effective tier without redirecting or throwing. Use this when you
 * want to RENDER different UI per tier rather than gate access.
 *
 * Returns:
 *   { tier: "unauth" }              — no session
 *   { tier: "free", address }       — signed in, no Pro subscription
 *   { tier: "pro", address }        — signed in, active Pro or in grace period
 */
export async function getTier(
  cookies: { get: (name: string) => { value: string } | undefined },
): Promise<
  | { tier: "unauth"; address: null }
  | { tier: "free"; address: string }
  | { tier: "pro"; address: string }
> {
  const session = await getSession(cookies);
  if (!session) return { tier: "unauth", address: null };

  const sub = await getSubscription(session.address);
  const isPro =
    (sub.status === "active" && sub.tier === "pro") ||
    isInGracePeriod(sub, "pro");

  return isPro
    ? { tier: "pro", address: session.address }
    : { tier: "free", address: session.address };
}

/**
 * Throws 401/403 Response if user doesn't have required tier.
 * Checks status === "active" OR within 3-day grace period (crypto only).
 */
export async function requireTier(
  cookies: { get: (name: string) => { value: string } | undefined },
  requiredTier: Tier,
): Promise<{ address: string; subscription: Subscription }> {
  const session = await getSession(cookies);
  if (!session) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const sub = await getSubscription(session.address);

  const hasAccess =
    (sub.status === "active" && sub.tier === requiredTier) ||
    isInGracePeriod(sub, requiredTier);

  if (!hasAccess) {
    throw new Response(
      JSON.stringify({ error: "upgrade_required", requiredTier }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return { address: session.address, subscription: sub };
}

// ── AI rate limiting ──

/**
 * Check if request includes a valid-looking user-provided AI key.
 * Accepts either `x-ai-key` (used by the intel query route for any provider)
 * or `x-anthropic-api-key` (used by portfolio query + UI BYOK settings).
 * Either header being present with a plausible key length bypasses managed rate limiting.
 */
function isBYOK(request: NextRequest): boolean {
  const anthropicKey = request.headers.get("x-anthropic-api-key");
  if (anthropicKey && anthropicKey.startsWith("sk-ant-") && anthropicKey.length >= 20) {
    return true;
  }
  // Validate x-ai-key with provider-specific prefix checks to prevent
  // trivial bypass with arbitrary 20-char strings
  const aiKey = request.headers.get("x-ai-key");
  if (!aiKey || aiKey.length < 20) return false;
  const provider = request.headers.get("x-ai-provider");
  if (provider === "google") return aiKey.startsWith("AIza");
  if (provider === "openai") return aiKey.startsWith("sk-");
  // Anthropic via x-ai-key (alternative to x-anthropic-api-key)
  if (provider === "anthropic") return aiKey.startsWith("sk-ant-");
  // Unknown provider — require a plausible key prefix
  return aiKey.startsWith("sk-") || aiKey.startsWith("AIza") || aiKey.startsWith("sk-ant-");
}

/**
 * Monthly AI limits per Pro user (managed usage only — BYOK bypasses).
 * Tuned for Haiku 4.5 pricing to keep worst-case margin >80% at $9/mo.
 *
 * Pre-2026-05-01 there was a separate `investigation` bucket (10/mo)
 * for the multi-turn investigate flow. The investigate route was cut
 * alongside the Neo4j removal; that bucket is gone. All AI consumers
 * share the single 50/mo `intel_query` + `portfolio_query` bucket.
 * Old `investigation`-kind rows in `ai_usage` simply stop counting.
 */
export const MONTHLY_QUERY_LIMIT = 50;

type QueryKind = "intel_query" | "portfolio_query";

/** Per-kind monthly limits. All query types share the 50/mo bucket. */
const LIMIT_FOR_KIND: Record<QueryKind, number> = {
  intel_query: MONTHLY_QUERY_LIMIT,
  portfolio_query: MONTHLY_QUERY_LIMIT,
};

/** Query types that count against the shared "query" bucket. */
const QUERY_KINDS_SHARED_BUCKET: QueryKind[] = ["intel_query", "portfolio_query"];

/**
 * Check AI rate limit. Throws 429 if exceeded.
 * BYOK users bypass rate limits (they pay their own API costs).
 *
 * Managed Pro users get 50 queries per calendar month (intel_query +
 * portfolio_query combined).
 */
export async function checkAiRateLimit(
  address: string,
  request: NextRequest,
  queryType: QueryKind = "intel_query",
): Promise<void> {
  if (isBYOK(request)) return;

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);

  // All query types share a single bucket since the dedicated
  // investigation bucket was retired in the Neo4j cut.
  const kindsToCount: QueryKind[] = QUERY_KINDS_SHARED_BUCKET;

  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiUsage)
    .where(
      and(
        eq(aiUsage.userAddress, address),
        gte(aiUsage.createdAt, monthStart),
        inArray(aiUsage.queryType, kindsToCount),
      ),
    );

  const limit = LIMIT_FOR_KIND[queryType];
  if ((result[0]?.count ?? 0) >= limit) {
    throw new Response(
      JSON.stringify({
        error: "rate_limit",
        limit,
        queryType,
        resetAt: "first of next month (UTC)",
      }),
      { status: 429, headers: { "Content-Type": "application/json" } },
    );
  }
}

/**
 * Guard for portfolio query route. Requires an active Pro subscription.
 * BYOK users still need Pro (their API key only unlocks unlimited managed usage).
 */
export async function requirePortfolioQueryAccess(
  cookies: { get: (name: string) => { value: string } | undefined },
  request: NextRequest,
): Promise<{ address: string; subscription: Subscription; usingBYOK: boolean }> {
  const session = await getSession(cookies);
  if (!session) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const sub = await getSubscription(session.address);
  const usingBYOK = isBYOK(request);

  const hasAccess =
    (sub.status === "active" && sub.tier === "pro") ||
    isInGracePeriod(sub, "pro");

  if (!hasAccess) {
    throw new Response(
      JSON.stringify({
        error: "upgrade_required",
        message: "Pro subscription required for Portfolio Query",
      }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );
  }

  return { address: session.address, subscription: sub, usingBYOK };
}
