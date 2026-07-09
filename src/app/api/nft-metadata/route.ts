import { NextRequest, NextResponse } from "next/server";
import {
  fetchMetadataFromHexUri,
  decodeHexUri,
} from "@/lib/nft-metadata-fetcher";

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=2592000, s-maxage=2592000, immutable",
};

export async function GET(request: NextRequest) {
  const uri = request.nextUrl.searchParams.get("uri");
  if (!uri) {
    return NextResponse.json({ error: "Missing uri param" }, { status: 400 });
  }

  if (!decodeHexUri(uri)) {
    return NextResponse.json({ error: "Invalid hex URI" }, { status: 400 });
  }

  const result = await fetchMetadataFromHexUri(uri);
  if (!result) {
    return NextResponse.json(
      { error: "Could not resolve metadata" },
      { status: 502 },
    );
  }

  return NextResponse.json(
    {
      imageUrl: result.imageUrl,
      name: result.name,
      description: result.description,
      attributes: result.attributes,
    },
    { headers: CACHE_HEADERS },
  );
}
