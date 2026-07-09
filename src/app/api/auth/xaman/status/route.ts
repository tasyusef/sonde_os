import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { XummSdk } from "xumm-sdk";
import { createSession, getSession } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import {
  verifyPendingToken,
  consumePendingToken,
  clearPendingAuthCookie,
} from "../../pending-auth-store";
import logger from "@/lib/logger";

const XAMAN_PENDING_COOKIE = "sonde-pending-xaman";

let _xumm: XummSdk | null = null;
function getXumm() {
  if (!_xumm) {
    _xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
  }
  return _xumm;
}

const checkRateLimit = rateLimit("auth-xaman-status", 60);

/**
 * GET /api/auth/xaman/status?uuid=X
 * Polls Xaman for payload resolution.
 * Returns { status: "pending" } or { status: "resolved", address } with Set-Cookie.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }
  const uuid = request.nextUrl.searchParams.get("uuid");
  if (!uuid) {
    return NextResponse.json({ error: "uuid is required" }, { status: 400 });
  }

  // Validate UUID format (standard UUID v4)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)) {
    return NextResponse.json({ error: "Invalid UUID format" }, { status: 400 });
  }

  // SECURITY: bind the redemption to the originating browser via the
  // HttpOnly pending-auth cookie set by POST /api/auth/xaman. Without
  // this check, anyone who knows the UUID can hijack the resulting
  // session.
  const cookieStore = await cookies();
  const pendingCookie = cookieStore.get(XAMAN_PENDING_COOKIE)?.value;
  if (!verifyPendingToken(uuid, pendingCookie)) {
    return NextResponse.json(
      { error: "Pending auth token missing or expired" },
      { status: 403 },
    );
  }

  if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
    return NextResponse.json({ error: "Xaman authentication not configured" }, { status: 503 });
  }

  try {
    const xumm = getXumm();
    const payload = await xumm.payload.get(uuid);
    if (!payload) {
      return NextResponse.json({ error: "Payload not found" }, { status: 404 });
    }

    // Not yet resolved
    if (!payload.response.resolved_at) {
      return NextResponse.json({ status: "pending" });
    }

    // Rejected, unsigned, or no account
    const address = payload.response.account;
    if (!address || payload.meta?.signed !== true) {
      return NextResponse.json({ status: "rejected" });
    }

    // Resolved — create session only if one doesn't already exist for this address
    const existing = await getSession(cookieStore);
    if (existing?.address === address) {
      consumePendingToken(uuid);
      const res = NextResponse.json({ status: "resolved", address });
      res.headers.append("Set-Cookie", clearPendingAuthCookie(XAMAN_PENDING_COOKIE));
      return res;
    }

    consumePendingToken(uuid);
    const setCookie = await createSession(address);
    const res = NextResponse.json({ status: "resolved", address });
    res.headers.append("Set-Cookie", setCookie);
    res.headers.append("Set-Cookie", clearPendingAuthCookie(XAMAN_PENDING_COOKIE));
    return res;
  } catch (err) {
    logger.error({ err }, "[auth/xaman/status] Error");
    return NextResponse.json(
      { error: "Failed to check payload status" },
      { status: 500 },
    );
  }
}
