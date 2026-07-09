import { randomBytes } from "crypto";
import { LRUCache } from "@/lib/cache";

/**
 * In-memory pending-auth token store. Used to bind a signed wallet auth
 * payload (Xaman UUID, Joey challenge nonce) to the originating browser
 * via an HttpOnly cookie, so a third party who scrapes the UUID/nonce
 * can't redeem the resulting session.
 *
 * Pre-2026-05-05: the Xaman /status route accepted any well-formed UUID
 * and returned a session for whatever address signed it. There was no
 * binding between the requester who created the payload and the
 * requester polling for it — an attacker who learned the UUID
 * (network log scrape, leaked deeplink, side channel) could hijack the
 * resulting session. The Joey challenge had the same shape: nonces were
 * issued without requester binding so a phished signature could be
 * replayed by the attacker.
 *
 * Capacity 1000, TTL 5 min — matches the Xumm payload + Joey challenge
 * expiry windows. Single-tab use case is the norm; if a user creates
 * two payloads in different tabs, the cookie from the second one
 * overwrites the first and the first becomes unredeemable. That's a
 * benign UX edge case (just retry) and acceptable vs the security gain.
 */
const PENDING_TTL_MS = 5 * 60 * 1000;
const store = new LRUCache<string>(1000, PENDING_TTL_MS);

export const PENDING_AUTH_TTL_SECONDS = PENDING_TTL_MS / 1000;

/** Generate a fresh opaque token, store it under `key`, and return it. */
export function createPendingToken(key: string): string {
  const token = randomBytes(24).toString("hex");
  store.set(key, token);
  return token;
}

/** Returns true if `token` matches the stored token for `key`. */
export function verifyPendingToken(
  key: string,
  token: string | undefined,
): boolean {
  if (!token) return false;
  const stored = store.get(key);
  if (!stored) return false;
  return stored === token;
}

/** Remove the entry — call after a successful redemption. */
export function consumePendingToken(key: string): void {
  store.delete(key);
}

/** Build a Set-Cookie value for a pending-auth cookie. */
export function pendingAuthCookie(name: string, value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${PENDING_AUTH_TTL_SECONDS}${secure}`;
}

/** Build a Set-Cookie that clears a pending-auth cookie. */
export function clearPendingAuthCookie(name: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}
