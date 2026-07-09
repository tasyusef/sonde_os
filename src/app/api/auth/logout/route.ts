import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession, deleteSession } from "@/lib/auth";
import logger from "@/lib/logger";

/**
 * POST /api/auth/logout
 * Deletes the session and always clears the cookie.
 */
export async function POST() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const clearCookie =
    `sonde-session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;

  try {
    const cookieStore = await cookies();
    const session = await getSession(cookieStore);

    if (session) {
      await deleteSession(session.sessionId);
    }
  } catch (err) {
    logger.error({ err }, "[auth/logout] Error");
  }

  // Always clear the cookie, even if session lookup failed
  const res = NextResponse.json({ ok: true });
  res.headers.set("Set-Cookie", clearCookie);
  return res;
}
