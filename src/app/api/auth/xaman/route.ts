import { NextResponse } from "next/server";
import { XummSdk } from "xumm-sdk";
import {
  createPendingToken,
  pendingAuthCookie,
} from "../pending-auth-store";
import logger from "@/lib/logger";

const XAMAN_PENDING_COOKIE = "sonde-pending-xaman";

let _xumm: XummSdk | null = null;
function getXumm() {
  if (!_xumm) {
    _xumm = new XummSdk(process.env.XUMM_API_KEY, process.env.XUMM_API_SECRET);
  }
  return _xumm;
}

/**
 * POST /api/auth/xaman
 * Creates a Xaman SignIn payload for wallet authentication.
 * Returns { uuid, qrUrl, deeplink } for the frontend to display.
 *
 * SECURITY: also issues an HttpOnly `sonde-pending-xaman` cookie bound
 * to the payload UUID. The /status route requires the matching cookie
 * before redeeming a session — without this, any caller who knows the
 * UUID could hijack the signed session.
 */
export async function POST() {
  if (!process.env.XUMM_API_KEY || !process.env.XUMM_API_SECRET) {
    return NextResponse.json({ error: "Xaman authentication not configured" }, { status: 503 });
  }

  try {
    const xumm = getXumm();
    const payload = await xumm.payload.create({
      txjson: { TransactionType: "SignIn" as never },
      options: {
        expire: 5, // minutes
      },
    });

    if (!payload) {
      return NextResponse.json(
        { error: "Failed to create Xaman payload" },
        { status: 500 },
      );
    }

    const pendingToken = createPendingToken(payload.uuid);
    const res = NextResponse.json({
      uuid: payload.uuid,
      qrUrl: payload.refs.qr_png,
      deeplink: payload.next.always,
    });
    res.headers.append(
      "Set-Cookie",
      pendingAuthCookie(XAMAN_PENDING_COOKIE, pendingToken),
    );
    return res;
  } catch (err) {
    logger.error({ err }, "[auth/xaman] Failed to create payload");
    return NextResponse.json(
      { error: "Failed to create sign-in request" },
      { status: 500 },
    );
  }
}
