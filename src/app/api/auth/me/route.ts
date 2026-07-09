import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";

/**
 * GET /api/auth/me
 * Returns the authenticated address or null.
 */
export async function GET() {
  try {
    const cookieStore = await cookies();
    const session = await getSession(cookieStore);
    return NextResponse.json({ address: session?.address ?? null });
  } catch {
    return NextResponse.json({ address: null });
  }
}
