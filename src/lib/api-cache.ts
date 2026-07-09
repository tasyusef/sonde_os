import { NextResponse } from "next/server";

/**
 * Wrap a NextResponse.json() with Cache-Control headers.
 *
 * @param data - JSON-serializable response body
 * @param maxAge - s-maxage in seconds (CDN/proxy cache duration)
 * @param staleWhileRevalidate - stale-while-revalidate window in seconds
 * @param options - additional NextResponse options (status, headers, etc.)
 */
export function cachedJson<T>(
  data: T,
  maxAge: number,
  staleWhileRevalidate?: number,
  options?: { status?: number },
): NextResponse<T> {
  const swr = staleWhileRevalidate ?? maxAge * 2;
  return NextResponse.json(data, {
    ...options,
    headers: {
      "Cache-Control": `public, s-maxage=${maxAge}, stale-while-revalidate=${swr}`,
    },
  });
}
