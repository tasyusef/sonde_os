/**
 * Pure helpers for NFT metadata and images loaded straight from the
 * browser: which URLs to try (IPFS / Arweave gateway fallback), which
 * URLs are safe at all, and how to read a metadata JSON body.
 *
 * Safety: only `https:` on the default port, no credentials, no private
 * or internal hosts (`isAllowedUrl`). `ipfs://` and `ar://` are rewritten
 * to public gateways. `http:`, `javascript:` and `data:` never pass.
 */

import { z } from "zod";
import {
  arweaveGatewayUrls,
  extractArweavePath,
  IPFS_GATEWAYS,
  isAllowedUrl,
  isAutoLoadHost,
} from "./nft-hosts";

export interface ResolvedMetadata {
  name: string | null;
  /** From the JSON `collection` / `collection_name` / `properties`
   *  fields, or a description prefix. Preferred over name consensus. */
  collectionName: string | null;
  /** First candidate URL; `imageUrls()` expands it into the fallbacks. */
  imageUrl: string | null;
  description: string | null;
  attributes: Array<{ trait_type: string; value: string | number }> | null;
}

/* ---- URL candidates --------------------------------------------- */

const CID = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{50,})/;

/** CID + path for `ipfs://…`, a bare CID, a `<cid>.ipfs.<gateway>` URL
 *  or any https URL with an `/ipfs/<cid>` path.
 *
 *  `#` is part of the filename, not a fragment: about 1 in 5 mainnet
 *  NFTs point at files like `ipfs://<cid>/Ape #12.json`. Only an https
 *  URL's `?query` is dropped. */
export function parseIpfs(uri: string): { cid: string; path: string } | null {
  const split = (rest: string) => {
    const m = CID.exec(rest);
    if (!m) return null;
    return { cid: m[1], path: rest.slice(m[1].length) };
  };
  if (uri.startsWith("ipfs://")) return split(uri.slice(7).replace(/^ipfs\//, ""));
  if (CID.test(uri)) return split(uri);
  const sub = /^https?:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{50,})\.ipfs\.[a-z0-9.-]+(\/[^?]*)?/i.exec(uri);
  if (sub) return { cid: sub[1], path: sub[2] ?? "" };
  const gw = /^https?:\/\/[^/]+\/ipfs\/([^?]+)/.exec(uri);
  if (gw) return split(gw[1]);
  return null;
}

function encodePath(path: string): string {
  if (!path || path === "/") return "";
  return (
    "/" +
    path
      .replace(/^\//, "")
      .split("/")
      .map((seg) => {
        try {
          return encodeURIComponent(decodeURIComponent(seg));
        } catch {
          return encodeURIComponent(seg);
        }
      })
      .join("/")
  );
}

/**
 * URLs to try, in order, for an NFT URI or image reference. Empty when
 * the reference isn't something a browser should load.
 */
export function mediaUrls(ref: string | null | undefined): string[] {
  const uri = ref?.trim();
  if (!uri) return [];
  const ipfs = parseIpfs(uri);
  if (ipfs) {
    const path = encodePath(ipfs.path);
    return IPFS_GATEWAYS.map((gw) => `${gw}${ipfs.cid}${path}`);
  }
  const ar = extractArweavePath(uri);
  if (ar) return arweaveGatewayUrls(ar);
  return isAllowedUrl(uri) ? [uri] : [];
}

/** A same-origin path like `/tokens/xrp.svg`. Not `//host/x` or
 *  `/\host/x`: browsers read both as another host. */
export function isLocalPath(src: string): boolean {
  return /^\/(?![/\\])/.test(src);
}

/** `<img>` candidates: a local asset as is, anything else through
 *  `mediaUrls`. */
export function imageUrls(src: string): string[] {
  return isLocalPath(src) ? [src] : mediaUrls(src);
}

/** The host a visitor has to OK before `ref` loads (the first
 *  candidate not on a gateway or trusted host). Null when it loads
 *  without asking, is a local path, or can't load at all. */
export function hostToApprove(ref: string | null | undefined): string | null {
  if (!ref || isLocalPath(ref)) return null;
  for (const url of mediaUrls(ref)) {
    let host: string;
    try {
      host = new URL(url).hostname.replace(/\.+$/, "");
    } catch {
      continue;
    }
    if (!isAutoLoadHost(host)) return host;
  }
  return null;
}

/* ---- Metadata JSON ---------------------------------------------- */

/** Loose by design: third-party metadata comes in every shape. This only
 *  guarantees an object before field-level extraction. */
const RawMetadataSchema = z
  .object({
    name: z.unknown().optional(),
    collection: z.unknown().optional(),
    collection_name: z.unknown().optional(),
    description: z.unknown().optional(),
    image: z.unknown().optional(),
    image_url: z.unknown().optional(),
    animation_url: z.unknown().optional(),
    attributes: z.unknown().optional(),
    properties: z.unknown().optional(),
  })
  .passthrough();

function extractString(field: unknown): string | undefined {
  if (typeof field === "string") return field.trim() || undefined;
  if (field && typeof field === "object") {
    for (const v of Object.values(field as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  return undefined;
}

function pickCollectionShape(field: unknown): string | null {
  if (typeof field === "string") return field.trim() || null;
  if (field && typeof field === "object") {
    return extractString((field as Record<string, unknown>).name) ?? null;
  }
  return null;
}

/** "Pixel Ape Rowboat Club: Generations…" → "Pixel Ape Rowboat Club".
 *  Rejects prefixes with digits or `#` (those are per-NFT names). */
function collectionFromDescription(desc: string): string | null {
  const m = desc.match(/^([^:]{2,60})[:—–-]\s/);
  if (!m) return null;
  const candidate = m[1].trim();
  if (/[#0-9]/.test(candidate) || candidate.length < 3) return null;
  return candidate;
}

function collectionFromMetadata(data: Record<string, unknown>): string | null {
  const top = pickCollectionShape(data.collection) ?? extractString(data.collection_name);
  if (top) return top;
  if (data.properties && typeof data.properties === "object") {
    const props = data.properties as Record<string, unknown>;
    const nested = pickCollectionShape(props.collection) ?? extractString(props.collection_name);
    if (nested) return nested;
  }
  const desc = extractString(data.description);
  return desc ? collectionFromDescription(desc) : null;
}

function parseAttributes(data: Record<string, unknown>): ResolvedMetadata["attributes"] {
  const raw = Array.isArray(data.attributes)
    ? data.attributes
    : Array.isArray(data.properties)
      ? data.properties
      : null;
  if (!raw) return null;
  return raw
    .filter(
      (a): a is Record<string, unknown> =>
        !!a && typeof a === "object" && "trait_type" in a && "value" in a,
    )
    .map((a) => ({
      trait_type: String(a.trait_type),
      value: typeof a.value === "number" ? a.value : String(a.value ?? ""),
    }));
}

/** Read a parsed metadata body. Null when it isn't an object. */
export function parseMetadata(json: unknown): ResolvedMetadata | null {
  const result = RawMetadataSchema.safeParse(json);
  if (!result.success || Array.isArray(json)) return null;
  const data = result.data;
  const image = extractString(data.image ?? data.image_url ?? data.animation_url);
  return {
    name: extractString(data.name) ?? null,
    collectionName: collectionFromMetadata(data),
    imageUrl: mediaUrls(image)[0] ?? null,
    description: extractString(data.description) ?? null,
    attributes: parseAttributes(data),
  };
}
