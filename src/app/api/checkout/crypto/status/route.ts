import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq, and } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { cryptoPayments } from "@/db/schema";
import logger from "@/lib/logger";

/**
 * GET /api/checkout/crypto/status?id={paymentId}
 * Poll payment status. Client polls until "verified" or "expired".
 */
export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const paymentId = request.nextUrl.searchParams.get("id");
  if (!paymentId) {
    return NextResponse.json({ error: "Missing payment id" }, { status: 400 });
  }

  // Wrap PG access — a transient Postgres hiccup during active checkout
  // would otherwise turn into a noisy 500 cascade in the user's browser
  // console as the client polls. Returning {status: "unknown"} keeps the
  // poller calm and the user sees nothing happen for one tick.
  try {
    const payment = await db.query.cryptoPayments.findFirst({
      where: and(
        eq(cryptoPayments.id, paymentId),
        eq(cryptoPayments.userAddress, session.address),
      ),
    });

    if (!payment) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }

    // Check if payment window expired (client-side expiry — PaymentWatcher
    // handles actual expiry via SubscriptionExpiryChecker)
    if (payment.status === "pending" && new Date() > payment.expiresAt) {
      return NextResponse.json({ status: "expired" });
    }

    return NextResponse.json({
      status: payment.status,
      tier: payment.tier,
      txHash: payment.txHash,
    });
  } catch (err) {
    logger.warn({ err, paymentId }, "[checkout/crypto/status] DB lookup failed");
    return NextResponse.json({ status: "unknown" });
  }
}
