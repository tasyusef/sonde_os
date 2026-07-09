import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { alertRules } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { rateLimit, getClientIp } from "@/lib/rate-limit";
import { invalidateRulesCache } from "@/lib/alert-engine";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";

export const dynamic = "force-dynamic";

const VALID_TYPES = ["whale_movement", "anomaly_spike", "watchlist_activity", "token_health_drop", "smart_money_trade"];
const VALID_DIRECTIONS = ["any", "buy", "sell"];
const checkRateLimit = rateLimit("intel-alerts", 30);

/**
 * Validate the shape of `conditions` before persisting it. The downstream
 * alert engine reads these values into CH queries; even with parameterized
 * queries, write-time validation is the more durable fix because it stops
 * bad data from ever reaching the engine cache. Returns an error message
 * string when invalid, or null when ok.
 */
function validateConditions(conditions: unknown): string | null {
  if (conditions == null) return null;
  if (typeof conditions !== "object" || Array.isArray(conditions)) {
    return "conditions must be an object";
  }
  const c = conditions as Record<string, unknown>;

  // addresses[] — must be valid XRPL r-addresses. This is the field that
  // was SQL-injectable in the smart_money_trade rule type pre-2026-05-05.
  if (c.addresses !== undefined) {
    if (!Array.isArray(c.addresses) || c.addresses.length > 50) {
      return "conditions.addresses must be an array of at most 50 entries";
    }
    for (const addr of c.addresses) {
      if (typeof addr !== "string" || !XRPL_ADDRESS_RE.test(addr)) {
        return "conditions.addresses entries must be valid XRPL addresses";
      }
    }
  }

  if (c.direction !== undefined && !VALID_DIRECTIONS.includes(c.direction as string)) {
    return `conditions.direction must be one of: ${VALID_DIRECTIONS.join(", ")}`;
  }

  if (c.minVolumeDrops !== undefined) {
    const v = c.minVolumeDrops;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
      return "conditions.minVolumeDrops must be a non-negative number";
    }
  }

  // currency / issuer for token_health_drop
  if (c.currency !== undefined) {
    if (typeof c.currency !== "string" || c.currency.length > 40) {
      return "conditions.currency must be a string up to 40 chars";
    }
  }
  if (c.issuer !== undefined) {
    if (typeof c.issuer !== "string" || !XRPL_ADDRESS_RE.test(c.issuer)) {
      return "conditions.issuer must be a valid XRPL address";
    }
  }

  return null;
}

/** GET — list alert rules for authenticated user */
export async function GET() {
  const session = await getSession(await cookies());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rules = await db
    .select()
    .from(alertRules)
    .where(sql`${alertRules.userAddress} = ${session.address}`)
    .orderBy(sql`${alertRules.createdAt} DESC`);

  return NextResponse.json({ rules });
}

/** POST — create a new alert rule */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  if (!checkRateLimit(ip)) return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  const session = await getSession(await cookies());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { type: string; conditions?: Record<string, unknown> };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.type || !VALID_TYPES.includes(body.type)) {
    return NextResponse.json({ error: `type must be one of: ${VALID_TYPES.join(", ")}` }, { status: 400 });
  }

  const condErr = validateConditions(body.conditions);
  if (condErr) return NextResponse.json({ error: condErr }, { status: 400 });

  // Cap at 20 rules per user
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(alertRules)
    .where(sql`${alertRules.userAddress} = ${session.address}`);
  if (count >= 20) {
    return NextResponse.json({ error: "Maximum 20 alert rules per account" }, { status: 403 });
  }

  const [rule] = await db
    .insert(alertRules)
    .values({
      userAddress: session.address,
      type: body.type,
      conditionsJson: body.conditions ?? null,
    })
    .returning();

  invalidateRulesCache();
  return NextResponse.json({ rule }, { status: 201 });
}

/** PUT — update an alert rule (toggle enabled, update conditions) */
export async function PUT(request: NextRequest) {
  const session = await getSession(await cookies());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { id: number; enabled?: boolean; conditions?: Record<string, unknown> };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  if (body.conditions !== undefined) {
    const condErr = validateConditions(body.conditions);
    if (condErr) return NextResponse.json({ error: condErr }, { status: 400 });
  }

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.enabled !== undefined) {
    sets.push("enabled");
    values.push(body.enabled);
  }
  if (body.conditions !== undefined) {
    sets.push("conditions_json");
    values.push(body.conditions);
  }

  if (sets.length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  // Build update dynamically
  const result = await db.execute(sql`
    UPDATE alert_rules
    SET
      ${body.enabled !== undefined ? sql`enabled = ${body.enabled},` : sql``}
      ${body.conditions !== undefined ? sql`conditions_json = ${JSON.stringify(body.conditions)}::jsonb,` : sql``}
      created_at = created_at
    WHERE id = ${body.id} AND user_address = ${session.address}
    RETURNING *
  `);

  if (result.length === 0) return NextResponse.json({ error: "Rule not found" }, { status: 404 });

  invalidateRulesCache();
  return NextResponse.json({ rule: result[0] });
}

/** DELETE — remove an alert rule */
export async function DELETE(request: NextRequest) {
  const session = await getSession(await cookies());
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { id: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });

  await db.execute(sql`
    DELETE FROM alert_rules
    WHERE id = ${body.id} AND user_address = ${session.address}
  `);

  invalidateRulesCache();
  return NextResponse.json({ ok: true });
}
