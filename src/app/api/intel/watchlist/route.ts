import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { watchlistItems } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getSubscription } from "@/lib/subscription";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

export const dynamic = "force-dynamic";

const FREE_TIER_LIMIT = 5;
const checkRateLimit = rateLimit("intel-watchlist", 30);

/** GET — list watched addresses for authenticated user */
export async function GET() {
  const session = await getSession(await cookies());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const items = await db
    .select({
      watchedAddress: watchlistItems.watchedAddress,
      label: watchlistItems.label,
      addedAt: watchlistItems.addedAt,
    })
    .from(watchlistItems)
    .where(sql`${watchlistItems.userAddress} = ${session.address}`)
    .orderBy(sql`${watchlistItems.addedAt} DESC`);

  return NextResponse.json({ items });
}

/** POST — add address to watchlist */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const session = await getSession(await cookies());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { address: string; label?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { address, label } = body;
  if (!address || !XRPL_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Valid XRPL address required" }, { status: 400 });
  }

  // Enforce free-tier limit
  const sub = await getSubscription(session.address);
  const isPro = sub?.tier === "pro";
  if (!isPro) {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(watchlistItems)
      .where(sql`${watchlistItems.userAddress} = ${session.address}`);
    if (count >= FREE_TIER_LIMIT) {
      return NextResponse.json(
        { error: `Free tier limited to ${FREE_TIER_LIMIT} addresses. Upgrade to Pro for unlimited.` },
        { status: 403 },
      );
    }
  }

  // Upsert — ignore conflict on duplicate
  await db
    .insert(watchlistItems)
    .values({
      userAddress: session.address,
      watchedAddress: address,
      label: label?.trim() || null,
    })
    .onConflictDoNothing();

  return NextResponse.json({ ok: true });
}

/** DELETE — remove address from watchlist */
export async function DELETE(request: NextRequest) {
  const session = await getSession(await cookies());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { address: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { address } = body;
  if (!address) return NextResponse.json({ error: "address required" }, { status: 400 });

  await db
    .delete(watchlistItems)
    .where(sql`${watchlistItems.userAddress} = ${session.address} AND ${watchlistItems.watchedAddress} = ${address}`);

  return NextResponse.json({ ok: true });
}
