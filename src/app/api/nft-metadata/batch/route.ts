import { NextRequest, NextResponse } from "next/server";
import { getNFTMetadataBatch } from "@/lib/nft-metadata-resolver";

const MAX_BATCH = 250;

interface ResolvedRow {
  name: string | null;
  imageUrl: string | null;
  /** Collection name extracted from the NFT's JSON metadata (`collection`,
   *  `collection_name`, or `properties.collection`). Authoritative when
   *  non-null — clients should prefer this over the per-NFT consensus
   *  fallback. Null when the metadata didn't carry one or the row
   *  predates collection-name extraction. */
  collectionName: string | null;
  issuer: string;
  taxon: number;
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const items =
    body && typeof body === "object" && "items" in body
      ? (body as { items: unknown }).items
      : null;

  if (!Array.isArray(items)) {
    return NextResponse.json(
      { error: "items must be an array" },
      { status: 400 },
    );
  }

  if (items.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `items exceeds max batch size (${MAX_BATCH})` },
      { status: 400 },
    );
  }

  const cleaned: Array<{ nftokenId: string; uri?: string | null }> = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const rec = it as Record<string, unknown>;
    const id = rec.nftokenId;
    if (typeof id !== "string" || !/^[A-Fa-f0-9]{64}$/.test(id)) continue;
    const uri = typeof rec.uri === "string" ? rec.uri : null;
    cleaned.push({ nftokenId: id, uri });
  }

  if (cleaned.length === 0) {
    return NextResponse.json({ results: {} });
  }

  const resolved = await getNFTMetadataBatch(cleaned);
  const results: Record<string, ResolvedRow> = {};
  for (const [id, row] of resolved) {
    results[id] = {
      name: row.name,
      imageUrl: row.imageUrl,
      collectionName: row.collectionName,
      issuer: row.issuer,
      taxon: row.taxon,
    };
  }

  return NextResponse.json({ results });
}
