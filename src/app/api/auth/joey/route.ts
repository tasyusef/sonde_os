import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { decode, verifySignature, deriveAddress } from "xrpl";
import { createSession } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import { consumeChallenge } from "./challenge-store";
import {
  verifyPendingToken,
  consumePendingToken,
  clearPendingAuthCookie,
} from "../pending-auth-store";
import logger from "@/lib/logger";

const JOEY_PENDING_COOKIE = "sonde-pending-joey";

/**
 * POST /api/auth/joey
 * Creates a session after verifying wallet ownership via a signed transaction.
 *
 * Flow:
 * 1. Client fetches a nonce from GET /api/auth/joey/challenge
 * 2. Client signs a dummy AccountSet tx with the nonce in a Memo via WalletConnect
 * 3. Client sends { tx_blob } here (the tx is NOT submitted to the ledger)
 * 4. Server decodes the blob, verifies the signature, checks the nonce,
 *    derives the address, and creates a session.
 */
const checkRateLimit = rateLimit("auth-joey", 5);

export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again in a minute." },
      { status: 429 },
    );
  }

  try {
    const body = await request.json();
    const txBlob: unknown = body?.tx_blob;

    if (!txBlob || typeof txBlob !== "string") {
      return NextResponse.json(
        { error: "tx_blob is required" },
        { status: 400 },
      );
    }

    // Decode the signed transaction
    let decoded: Record<string, unknown>;
    try {
      decoded = decode(txBlob) as Record<string, unknown>;
    } catch {
      return NextResponse.json(
        { error: "Invalid transaction blob" },
        { status: 400 },
      );
    }

    // Verify the cryptographic signature
    try {
      if (!verifySignature(txBlob)) {
        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 400 },
        );
      }
    } catch {
      return NextResponse.json(
        { error: "Signature verification failed" },
        { status: 400 },
      );
    }

    // Extract and validate the nonce from the Memo field
    const memos = decoded.Memos as Array<{ Memo: { MemoData?: string; MemoType?: string } }> | undefined;
    const memoData = memos?.[0]?.Memo?.MemoData;
    if (!memoData) {
      return NextResponse.json(
        { error: "Missing challenge nonce in memo" },
        { status: 400 },
      );
    }

    // MemoData is hex-encoded — decode to UTF-8
    const nonce = Buffer.from(memoData, "hex").toString("utf-8");

    // SECURITY: bind the redemption to the originating browser via the
    // HttpOnly pending-auth cookie set by GET /api/auth/joey/challenge.
    // Without this, an attacker who tricks a victim into signing a known
    // nonce could replay the victim's tx_blob to hijack the session.
    const cookieStore = await cookies();
    const pendingCookie = cookieStore.get(JOEY_PENDING_COOKIE)?.value;
    if (!verifyPendingToken(nonce, pendingCookie)) {
      return NextResponse.json(
        { error: "Pending auth token missing or expired" },
        { status: 403 },
      );
    }

    if (!consumeChallenge(nonce)) {
      return NextResponse.json(
        { error: "Invalid or expired challenge nonce" },
        { status: 400 },
      );
    }

    // Derive the address from the signing public key
    const signingPubKey = decoded.SigningPubKey as string;
    if (!signingPubKey) {
      return NextResponse.json(
        { error: "Missing signing public key" },
        { status: 400 },
      );
    }

    const address = deriveAddress(signingPubKey);
    if (!XRPL_ADDRESS_RE.test(address)) {
      return NextResponse.json(
        { error: "Derived address is invalid" },
        { status: 400 },
      );
    }

    consumePendingToken(nonce);
    const setCookie = await createSession(address);
    const res = NextResponse.json({ status: "resolved", address });
    res.headers.append("Set-Cookie", setCookie);
    res.headers.append("Set-Cookie", clearPendingAuthCookie(JOEY_PENDING_COOKIE));
    return res;
  } catch (err) {
    logger.error({ err }, "[auth/joey] Error");
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500 },
    );
  }
}
