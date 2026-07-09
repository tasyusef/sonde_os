import { NextResponse } from "next/server";
import { cachedJson } from "@/lib/api-cache";
import { getAccountMintedNfts } from "@/lib/clickhouse-queries";
import { parseNFTokenID } from "@/lib/nft-parsing";
import { XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import logger from "@/lib/logger";
import type { NFTBrowseItem } from "@/types/nft";

const log = logger.child({ module: "api/account/minted-nfts" });

/**
 * Lifetime NFTs minted BY this account. Returns `NFTBrowseItem[]` so the
 * existing `NFTGrid` component can render them without modification —
 * same shape as account_nfts results from rippled.
 *
 * Source: `transactions` table filtered to `tx_type = 'NFTokenMint'` and
 * `account = address`. The full NFTokenID comes from `meta.nftoken_id`
 * (rippled's convenience field on every successful mint), URI from the
 * tx body. Other fields (Flags, Taxon, Serial) are derived from
 * `parseNFTokenID()`.
 *
 * Caveat: bounded by the `transactions` backfill window (12 months).
 * Older mints don't appear.
 *
 * Caveat: uses the tx-level reading of "minted by" — NFTs whose mint
 * transaction was signed by this address. Under NFTokenMinter
 * delegation, NFTs minted on behalf of another account still show up
 * here (they carry the OTHER account as Issuer in the resulting
 * NFTokenID, but THIS account signed the mint). That matches the user
 * intuition "NFTs I minted."
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!XRPL_ADDRESS_RE.test(address)) {
    return NextResponse.json(
      { error: "Invalid XRPL address" },
      { status: 400 },
    );
  }

  const { searchParams } = new URL(req.url);
  const limitParam = searchParams.get("limit");
  const limit = Math.min(
    Math.max(limitParam ? parseInt(limitParam, 10) : 5000, 1),
    5000,
  );

  try {
    const rows = await getAccountMintedNfts(address, limit);
    const nfts: NFTBrowseItem[] = [];
    for (const row of rows) {
      const parsed = parseNFTokenID(row.nft_id);
      if (!parsed) continue;
      nfts.push({
        NFTokenID: row.nft_id,
        Issuer: parsed.issuer,
        URI: row.uri || undefined,
        Flags: parsed.flags,
        NFTokenTaxon: parsed.nft_taxon,
        nft_serial: parsed.nft_serial,
      });
    }
    // 60s edge cache + 5min stale-while-revalidate. Mints are immutable
    // once landed; same caching policy as the burns endpoint.
    return cachedJson({ nfts }, 60, 300);
  } catch (err) {
    log.error({ err, address }, "minted-nfts fetch failed");
    return NextResponse.json(
      { nfts: [], error: err instanceof Error ? err.message : "Unknown" },
      { status: 200 },
    );
  }
}
