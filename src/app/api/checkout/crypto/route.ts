import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { getSession } from "@/lib/auth";
import { db } from "@/db";
import { getXrpPrice } from "@/lib/price-data";
import { cryptoPayments } from "@/db/schema";
import { getPrice } from "@/lib/pricing";
import type { SubscriptionTier, BillingCycle, PaymentCurrency } from "@/lib/pricing";
import logger from "@/lib/logger";

let _xummPromise: Promise<import("xumm-sdk").XummSdk> | null = null;
function getXumm() {
  if (!_xummPromise) {
    _xummPromise = import("xumm-sdk").then(
      ({ XummSdk }) =>
        new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET),
    ).catch((err) => {
      _xummPromise = null;
      throw err;
    });
  }
  return _xummPromise;
}

/** Generate a unique 32-bit destination tag with collision check */
async function generateUniqueTag(): Promise<number> {
  for (let i = 0; i < 10; i++) {
    // Random tag between 1 and 2^31 - 1 (positive 32-bit int)
    const tag = Math.floor(Math.random() * 2_147_483_647) + 1;
    const existing = await db.query.cryptoPayments.findFirst({
      where: eq(cryptoPayments.destinationTag, tag),
      columns: { id: true },
    });
    if (!existing) return tag;
  }
  throw new Error("Failed to generate unique destination tag after 10 attempts");
}

/**
 * POST /api/checkout/crypto
 * Creates a pending crypto payment. Returns payment details for Xaman QR or WalletConnect signing.
 *
 * Body: { tier, cycle, currency, wallet }
 */
export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const session = await getSession(cookieStore);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const treasury = process.env.SONDE_TREASURY_ADDRESS;
  if (!treasury) {
    return NextResponse.json(
      { error: "Crypto payments not configured" },
      { status: 503 },
    );
  }

  let body: { tier: string; cycle: string; currency: string; wallet: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { tier, cycle, currency, wallet } = body;

  // Validate inputs
  if (tier !== "pro") {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }
  if (cycle !== "annual") {
    return NextResponse.json(
      { error: "Crypto payments only support annual billing" },
      { status: 400 },
    );
  }
  if (currency !== "XRP" && currency !== "RLUSD") {
    return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
  }
  if (wallet !== "xaman" && wallet !== "walletconnect") {
    return NextResponse.json({ error: "Invalid wallet" }, { status: 400 });
  }

  const priceUsd = getPrice(
    tier as SubscriptionTier,
    cycle as BillingCycle,
    "crypto",
  );

  // For RLUSD, amount equals the USD price directly (1:1 stablecoin).
  // For XRP, we need to fetch the current price and convert.
  let amount: string;
  if (currency === "RLUSD") {
    amount = priceUsd.toFixed(2);
  } else {
    // Fetch XRP/USD price directly (avoid self-fetch via Host header)
    const priceData = await getXrpPrice();
    if (!priceData.price || priceData.price <= 0) {
      return NextResponse.json(
        { error: "XRP price unavailable" },
        { status: 502 },
      );
    }
    // Add 1% buffer to account for price movement during payment window
    const xrpAmount = (priceUsd / priceData.price) * 1.01;
    amount = xrpAmount.toFixed(6);
  }

  const destinationTag = await generateUniqueTag();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

  // Insert pending payment row
  const [payment] = await db
    .insert(cryptoPayments)
    .values({
      userAddress: session.address,
      amount,
      currency: currency as PaymentCurrency,
      tier,
      billingCycle: cycle,
      destinationTag,
      status: "pending",
      walletProvider: wallet,
      expiresAt,
    })
    .returning();

  // Common response fields
  const result: Record<string, unknown> = {
    paymentId: payment.id,
    amount,
    currency,
    destination: treasury,
    destinationTag,
    expiresAt: expiresAt.toISOString(),
  };

  // For Xaman: also create a PaymentRequest via XUMM SDK with QR
  if (wallet === "xaman") {
    if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
      return NextResponse.json(
        { error: "Xaman payments not configured" },
        { status: 503 },
      );
    }

    try {
      const xumm = await getXumm();

      // Build XRPL Payment transaction
      const txjson: Record<string, unknown> = {
        TransactionType: "Payment",
        Destination: treasury,
        DestinationTag: destinationTag,
      };

      if (currency === "XRP") {
        // XRP amount in drops
        txjson.Amount = String(Math.ceil(parseFloat(amount) * 1_000_000));
      } else {
        // RLUSD issued currency
        txjson.Amount = {
          value: amount,
          currency: "524C555344000000000000000000000000000000", // RLUSD hex
          issuer: "rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De", // Ripple RLUSD issuer
        };
      }

      const payload = await xumm.payload.create({
        txjson: txjson as never,
        options: { expire: 30 }, // 30 minutes, matches our payment window
      });

      if (!payload) {
        return NextResponse.json(
          { error: "Failed to create Xaman payment" },
          { status: 500 },
        );
      }

      result.uuid = payload.uuid;
      result.qrUrl = payload.refs.qr_png;
      result.deeplink = payload.next.always;
    } catch (err) {
      logger.error({ err }, "[checkout/crypto] Xaman payload error");
      return NextResponse.json(
        { error: "Failed to create Xaman payment request" },
        { status: 500 },
      );
    }
  }

  // For WalletConnect: no server-side payload needed — client builds and signs the tx
  return NextResponse.json(result);
}
