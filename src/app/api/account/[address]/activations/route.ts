import { NextResponse } from "next/server";
import { getAccountActivations } from "@/lib/clickhouse-queries";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import { cachedJson } from "@/lib/api-cache";

/**
 * Lifetime activations BY this account — every account this address
 * funded into existence, pulled from `value_transfer_events` in CH.
 *
 * Replaces the legacy "scan AffectedNodes in the loaded tx window"
 * derivation. The old approach was bounded by whatever Payment-with-
 * AccountRoot-CreatedNode rows happened to be in the latest 20-50 txs;
 * an account that activated 50 others a year ago and is now busy with
 * unrelated activity would show 0 activations. This endpoint returns
 * the full lifetime list (capped at 500), newest first.
 *
 * Caveat preserved: activations older than the VTE backfill window
 * don't appear — same limitation as `/api/account/[address]/ancestry`.
 *
 * Response shape:
 *   { activations: AccountActivation[] }
 *
 * Each row:
 *   - activatedAddress  — address of the activated account
 *   - date              — XRPL epoch seconds of the activation Payment
 *   - amount            — funding amount in drops (string)
 *   - hash              — activation Payment hash
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!XRPL_ADDRESS_RE.test(address)) {
    return NextResponse.json({ error: "Invalid XRPL address" }, { status: 400 });
  }

  const { searchParams } = new URL(req.url);
  const limitParam = searchParams.get("limit");
  const limit = Math.min(
    Math.max(limitParam ? parseInt(limitParam, 10) : 500, 1),
    500,
  );

  try {
    const activations = await getAccountActivations(address, limit);
    // Activations are immutable once the funding tx lands — long cache
    // is fine. 60s edge / 5min stale-while-revalidate matches the burns
    // endpoint's policy.
    return cachedJson({ activations }, 60, 300);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { activations: [], error: message },
      { status: 200 },
    );
  }
}
