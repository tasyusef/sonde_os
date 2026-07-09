import { NextResponse } from "next/server";
import { query } from "@/lib/clickhouse-client";
import { parseNFTokenID } from "@/lib/nft-parsing";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import { cachedJson } from "@/lib/api-cache";

/**
 * Returns every NFTokenBurn this account initiated (i.e. account is the
 * actor on the burn tx), pulled directly from ClickHouse. Independent of
 * the account page's paginated tx window — for an account with thousands
 * of txs and a handful of burns, the previous "derive burns from the
 * loaded tx window" approach forced users to "Load More Transactions"
 * many times before any burn would show up. This pulls the full set in
 * one shot.
 *
 * Caveat surfaced to the caller: this only finds burns where THIS
 * account is the actor. NFTs minted by this account but burned later by
 * a holder don't appear in this account's tx history — they live in the
 * holder's history. Account_info exposes the total `BurnedNFTokens`
 * counter, so the UI can show "X of Y burns visible" when delta > 0 and
 * explain the rest were holder-initiated.
 *
 * Response shape:
 *   { burns: BurnRow[] }
 *
 * Each row:
 *   - nftId        — full 64-char hex NFTokenID
 *   - hash         — burn tx hash
 *   - timestamp    — CH DateTime literal (YYYY-MM-DD HH:MM:SS)
 *   - xrpl_date    — XRPL epoch seconds (matches the rippled tx.date field)
 *   - taxon        — parsed from NFTokenID, or null if parse fails
 *   - serial       — parsed from NFTokenID, or null
 *   - issuer       — parsed from NFTokenID (the original minter), or null
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
    Math.max(limitParam ? parseInt(limitParam, 10) : 200, 1),
    500,
  );

  try {
    const rows = await query<{
      tx_hash: string;
      timestamp: string;
      xrpl_date: number;
      tx_json: string;
    }>(
      `SELECT tx_hash,
              toString(timestamp)                                              AS timestamp,
              toUInt32(toUnixTimestamp(timestamp) - 946684800)                 AS xrpl_date,
              tx_json
       FROM transactions
       WHERE account = {address:String}
         AND tx_type = 'NFTokenBurn'
         AND meta_json LIKE '%"TransactionResult":"tesSUCCESS"%'
       ORDER BY timestamp DESC
       LIMIT {limit:UInt16}`,
      { address, limit },
    );

    const burns = rows
      .map((r) => {
        let nftId = "";
        try {
          const tx = JSON.parse(r.tx_json) as Record<string, unknown>;
          nftId = (tx.NFTokenID as string) ?? "";
        } catch {
          /* malformed tx_json — skip */
        }
        if (!nftId) return null;
        const parsed = parseNFTokenID(nftId);
        return {
          nftId,
          hash: r.tx_hash,
          timestamp: r.timestamp,
          xrpl_date: r.xrpl_date,
          taxon: parsed?.nft_taxon ?? null,
          serial: parsed?.nft_serial ?? null,
          issuer: parsed?.issuer ?? null,
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);

    // 60s edge cache + 5min stale-while-revalidate. Burns are immutable
    // once landed — no need for the 15s freshness the active tx tab
    // wants; longer caching is fine.
    return cachedJson({ burns }, 60, 300);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { burns: [], error: message },
      { status: 200 },
    );
  }
}
