import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { eq, and, gt, lt } from "drizzle-orm";
import { db } from "@/db";
import { authSessions, trackedAccounts } from "@/db/schema";
import { snapshotNow } from "./portfolio-snapshots";
import logger from "@/lib/logger";

export const COOKIE_NAME = "sonde-session";
const SESSION_DAYS = 7;

function getSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("AUTH_SECRET env var is required for auth");
  return new TextEncoder().encode(raw);
}

/** Create a session for an authenticated wallet address. Returns the Set-Cookie header value. */
export async function createSession(address: string): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  const token = await new SignJWT({ sessionId, address })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(getSecret());

  // Insert session row
  await db.insert(authSessions).values({
    id: sessionId,
    address,
    expiresAt,
  });

  // Upsert tracked account (first login creates it, subsequent logins are no-ops)
  await db
    .insert(trackedAccounts)
    .values({ address })
    .onConflictDoNothing();

  // Fire-and-forget: take an immediate portfolio snapshot so data is
  // available right away. Periodic snapshots run on a Hetzner systemd
  // timer (`sonde-portfolio-snapshot.timer`, every 5 min); this
  // on-login call ensures a freshly-authed wallet doesn't have to
  // wait up to 5 minutes for its first chart datapoint.
  snapshotNow(address).catch((err) =>
    logger.warn("[auth] On-login snapshot failed:", err instanceof Error ? err.message : err),
  );

  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=${SESSION_DAYS * 86400}`;
}

/** Validate the session cookie. Returns session info or null. */
export async function getSession(
  cookieStore: { get: (name: string) => { value: string } | undefined },
): Promise<{ sessionId: string; address: string } | null> {
  const cookie = cookieStore.get(COOKIE_NAME);
  if (!cookie?.value) return null;

  try {
    const { payload } = await jwtVerify(cookie.value, getSecret(), { algorithms: ["HS256"] });
    const sessionId = payload.sessionId;
    const address = payload.address;
    if (typeof sessionId !== "string" || typeof address !== "string") return null;
    if (!sessionId || !address) return null;

    // Check session still exists in DB and hasn't expired (defense-in-depth + revocation)
    const rows = await db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(and(eq(authSessions.id, sessionId), eq(authSessions.address, address), gt(authSessions.expiresAt, new Date())))
      .limit(1);

    if (rows.length === 0) return null;
    return { sessionId, address };
  } catch {
    return null;
  }
}

/** Delete a session and return a Set-Cookie header that clears the cookie. */
export async function deleteSession(sessionId: string): Promise<string> {
  await db.delete(authSessions).where(eq(authSessions.id, sessionId));
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/${secure}; Max-Age=0`;
}

/** Delete expired session rows. Call periodically to prevent unbounded table growth. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function cleanupExpiredSessions(): Promise<void> {
  await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
}
