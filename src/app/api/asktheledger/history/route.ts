import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireTier } from "@/lib/subscription";
import { getRecentHistory } from "@/lib/asktheledger-history";

export const dynamic = "force-dynamic";

/**
 * GET /api/asktheledger/history
 *
 * Returns the requesting Pro user's recent /asktheledger queries.
 * Used by the chat UI to populate the "Recent" rail above the empty
 * state on first load.
 *
 * Pro-only — Free + unauth get 401/403 from requireTier.
 */
export async function GET() {
  const cookieStore = await cookies();

  let session: Awaited<ReturnType<typeof requireTier>>;
  try {
    session = await requireTier(cookieStore, "pro");
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const entries = await getRecentHistory(session.address, 20);
  return NextResponse.json({ entries });
}
