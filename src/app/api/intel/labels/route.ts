import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { accountLabels } from "@/db/schema";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

export const dynamic = "force-dynamic";

const checkRateLimit = rateLimit("intel-labels", 30);

const TTL_DAYS = 30;

/**
 * GET /api/intel/labels
 *
 * ?account=r...        — Labels for a specific account
 * ?label=whale&limit=50 — Top accounts with a label
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  const { searchParams } = request.nextUrl;
  const account = searchParams.get("account");
  const label = searchParams.get("label");

  // Mode 1: Labels for a specific account (Free tier)
  if (account) {
    if (!XRPL_ADDRESS_RE.test(account)) {
      return NextResponse.json({ error: "Invalid XRPL address" }, { status: 400 });
    }

    try {
      const rows = await db
        .select({
          label: accountLabels.label,
          confidence: accountLabels.confidence,
          evidenceJson: accountLabels.evidenceJson,
          scoredAt: accountLabels.scoredAt,
        })
        .from(accountLabels)
        .where(sql`
          ${accountLabels.address} = ${account}
          AND ${accountLabels.scoredAt} > NOW() - INTERVAL '${sql.raw(String(TTL_DAYS))} days'
        `)
        .orderBy(sql`${accountLabels.confidence} DESC`);

      return NextResponse.json({
        account,
        labels: rows.map((r) => ({
          label: r.label,
          confidence: Number(r.confidence),
          evidence: r.evidenceJson,
          scoredAt: r.scoredAt,
        })),
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch labels" },
        { status: 500 },
      );
    }
  }

  // Mode 2: Top accounts with a specific label
  if (label) {
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 100);

    try {
      const rows = await db
        .select({
          address: accountLabels.address,
          confidence: accountLabels.confidence,
          evidenceJson: accountLabels.evidenceJson,
          scoredAt: accountLabels.scoredAt,
        })
        .from(accountLabels)
        .where(sql`
          ${accountLabels.label} = ${label}
          AND ${accountLabels.scoredAt} > NOW() - INTERVAL '${sql.raw(String(TTL_DAYS))} days'
        `)
        .orderBy(sql`${accountLabels.confidence} DESC`)
        .limit(limit);

      return NextResponse.json({
        label,
        accounts: rows.map((r) => ({
          address: r.address,
          confidence: Number(r.confidence),
          evidence: r.evidenceJson,
          scoredAt: r.scoredAt,
        })),
      });
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Failed to fetch label accounts" },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ error: "Provide ?account=r... or ?label=type" }, { status: 400 });
}
