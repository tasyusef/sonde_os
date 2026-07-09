/**
 * Shared in-memory rate limiter for API routes.
 *
 * Usage:
 *   const check = rateLimit("my-route", 10); // 10 req/min
 *   if (!check(ip)) return NextResponse.json({ error: "..." }, { status: 429 });
 */

import { type NextRequest } from "next/server";

const limiters = new Map<string, Map<string, { count: number; resetAt: number }>>();

/**
 * Extract the client IP from a request. Uses the rightmost x-forwarded-for
 * value (appended by the trusted reverse proxy) to prevent spoofing.
 * Falls back to "unknown" if no IP can be determined.
 */
export function getClientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    // Rightmost IP is the one added by our trusted proxy (Railway)
    return parts[parts.length - 1] ?? "unknown";
  }
  return "unknown";
}

export function rateLimit(namespace: string, limit: number, windowMs: number = 60_000) {
  if (!limiters.has(namespace)) limiters.set(namespace, new Map());
  const map = limiters.get(namespace)!;
  let lastCleanup = Date.now();

  return function check(ip: string): boolean {
    const now = Date.now();

    // Lazy cleanup: sweep expired entries periodically (every windowMs)
    if (now - lastCleanup > windowMs) {
      lastCleanup = now;
      for (const [key, entry] of map) {
        if (now > entry.resetAt) map.delete(key);
      }
    }

    const entry = map.get(ip);
    if (!entry || now > entry.resetAt) {
      map.set(ip, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= limit) return false;
    entry.count++;
    return true;
  };
}
