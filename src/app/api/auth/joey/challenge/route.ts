import { NextResponse } from "next/server";
import { createChallenge } from "../challenge-store";
import {
  createPendingToken,
  pendingAuthCookie,
} from "../../pending-auth-store";

const JOEY_PENDING_COOKIE = "sonde-pending-joey";

/**
 * GET /api/auth/joey/challenge
 * Returns a single-use nonce for the sign-in challenge.
 *
 * SECURITY: also sets an HttpOnly cookie binding the nonce to this
 * browser. POST /api/auth/joey requires the matching cookie before
 * accepting a signed tx_blob — without this binding, an attacker who
 * tricks a victim into signing a known nonce can replay the victim's
 * signature to hijack the session.
 */
export async function GET() {
  const nonce = createChallenge();
  const pendingToken = createPendingToken(nonce);
  const res = NextResponse.json({ nonce });
  res.headers.append(
    "Set-Cookie",
    pendingAuthCookie(JOEY_PENDING_COOKIE, pendingToken),
  );
  return res;
}
