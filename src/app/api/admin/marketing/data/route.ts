import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-auth";
import { fetchMarketingData } from "@/lib/marketing-data";

export const dynamic = "force-dynamic";

/**
 * Marketing data export — returns a snapshot of high-signal on-chain data
 * that can be dropped into tweet drafts. Thin wrapper around
 * `fetchMarketingData()` in lib/marketing-data.ts; the same helper is also
 * called server-side by the /marketing/card/[slug] screenshot route so the
 * admin preview and the exported screenshot stay in lockstep.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const data = await fetchMarketingData();
  return NextResponse.json(data);
}
