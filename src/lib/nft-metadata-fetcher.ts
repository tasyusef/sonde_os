import "server-only";
import { z } from "zod";
import {
  IPFS_GATEWAYS,
  isAllowedUrl,
  extractArweavePath,
  arweaveGatewayUrls,
} from "./nft-hosts";

const MAX_SIZE = 512 * 1024;
// Pinata's gateway is the most reliable for XRPL NFT metadata but
// frequently takes 5–10s to respond — it's a paid pinning service,
// public-gateway requests are deprioritized. 12s gives it headroom
// while still being well under the 20s outer timeout that bounds the
// whole fallback chain.
const FETCH_TIMEOUT = 12_000;
const TOTAL_TIMEOUT = 20_000;

export interface ResolvedMetadata {
  name: string | null;
  /** Collection name extracted from the JSON metadata's `collection`,
   *  `collection_name`, or `properties.collection` field — when present,
   *  the canonical authority for the collection's name. Null when the
   *  metadata didn't carry it. Consumers fall back to per-NFT-name
   *  consensus (`pickCollectionName`) only when this is null. */
  collectionName: string | null;
  imageUrl: string | null;
  description: string | null;
  attributes: Array<{ trait_type: string; value: string | number }> | null;
}

/**
 * Schema for raw third-party NFT metadata JSON (IPFS, HTTP).
 * Loose-by-design — third-party servers return wildly inconsistent shapes,
 * so we accept any object and let the field-level extraction handle the
 * cherry-picking. Zod's role here is to guarantee we got an object, not
 * an array or primitive, before downstream property access.
 */
const RawMetadataSchema = z
  .object({
    name: z.unknown().optional(),
    collection: z.unknown().optional(),
    collection_name: z.unknown().optional(),
    description: z.unknown().optional(),
    image: z.unknown().optional(),
    animation_url: z.unknown().optional(),
    attributes: z.unknown().optional(),
    properties: z.unknown().optional(),
  })
  .passthrough();

function resolveIpfsUri(uri: string): { cid: string; path: string } | null {
  if (uri.startsWith("ipfs://")) {
    const rest = uri.slice(7);
    const slashIdx = rest.indexOf("/");
    if (slashIdx === -1) return { cid: rest, path: "" };
    return { cid: rest.slice(0, slashIdx), path: rest.slice(slashIdx) };
  }
  if (uri.startsWith("Qm") || uri.startsWith("bafy")) {
    const slashIdx = uri.indexOf("/");
    if (slashIdx === -1) return { cid: uri, path: "" };
    return { cid: uri.slice(0, slashIdx), path: uri.slice(slashIdx) };
  }
  // Subdomain-form gateway URL: `https://<CID>.ipfs.<gateway>/<path>`.
  // Modern IPFS gateways (w3s.link, dweb.link, nftstorage.link, etc.)
  // host content under a CID-prefixed subdomain for cookie isolation.
  // Unmodified, those URLs would fall through to plain HTTPS fetch and
  // we'd never try our gateway-fallback chain — losing redundancy when
  // the original gateway is down. Recognizing the pattern lets us
  // attempt every gateway with the extracted CID.
  const subdomainMatch = uri.match(
    /^https?:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z0-9]{50,})\.ipfs\.[a-z0-9.-]+(\/.*)?$/i,
  );
  if (subdomainMatch) {
    const cid = subdomainMatch[1];
    const path = subdomainMatch[2] ?? "";
    return { cid, path };
  }
  return null;
}

function encodePath(path: string): string {
  if (!path) return "";
  return "/" + path.slice(1).split("/").map(encodeURIComponent).join("/");
}

function resolveUri(uri: string): string {
  const ipfs = resolveIpfsUri(uri);
  if (ipfs) {
    return `${IPFS_GATEWAYS[0]}${ipfs.cid}${encodePath(ipfs.path)}`;
  }
  return uri;
}

function extractString(field: unknown): string | undefined {
  if (typeof field === "string") return field || undefined;
  if (field && typeof field === "object") {
    for (const v of Object.values(field as Record<string, unknown>)) {
      if (typeof v === "string" && v) return v;
    }
  }
  return undefined;
}

export function decodeHexUri(hex: string): string | null {
  try {
    const decoded = Buffer.from(hex, "hex").toString("utf8");
    return decoded.trim().length > 0 ? decoded : null;
  } catch {
    return null;
  }
}

async function fetchWithTimeout(
  url: string,
  accept: string,
  outerSignal: AbortSignal,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  outerSignal.addEventListener("abort", () => controller.abort(), {
    once: true,
  });

  try {
    // `follow` instead of `manual` so we transparently follow the
    // subdomain-based redirects most modern IPFS gateways now use
    // (`bafkre…ipfs.dweb.link`, `bafkre…ipfs.nftstorage.link`, etc.)
    // for content-isolation. With `manual` those 30x responses were
    // treated as fetch failures and we never got the body — the silent
    // cause behind ~60% of pre-2026-05-09 NFT metadata "failed" rows.
    // SSRF stays bounded by the existing `isAllowedUrl` private-IP
    // filter (applied before fetch) plus 8s/15s timeouts; redirect
    // chains can't exfiltrate beyond what the original URL could.
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: accept },
      redirect: "follow",
    });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

async function readBodySafe(
  res: Response,
  maxBytes: number,
): Promise<string | null> {
  const reader = res.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const decoder = new TextDecoder();
  return (
    chunks.map((c) => decoder.decode(c, { stream: true })).join("") +
    decoder.decode()
  );
}

async function fetchWithGatewayFallback(
  rawUri: string,
  accept: string,
  outerSignal: AbortSignal,
): Promise<Response | null> {
  const ipfs = resolveIpfsUri(rawUri);

  if (ipfs) {
    const safePath = encodePath(ipfs.path);
    for (const gateway of IPFS_GATEWAYS) {
      if (outerSignal.aborted) break;
      try {
        const url = `${gateway}${ipfs.cid}${safePath}`;
        const res = await fetchWithTimeout(url, accept, outerSignal);
        if (res.ok) return res;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  const resolved = resolveUri(rawUri);
  const arPath = extractArweavePath(resolved);
  if (arPath) {
    for (const gwUrl of arweaveGatewayUrls(arPath)) {
      if (outerSignal.aborted) break;
      try {
        const res = await fetchWithTimeout(gwUrl, accept, outerSignal);
        if (res.ok) return res;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  if (!isAllowedUrl(resolved)) return null;
  try {
    const res = await fetchWithTimeout(resolved, accept, outerSignal);
    if (res.ok) return res;
  } catch {
    /* failed */
  }
  return null;
}

/**
 * Fetch and parse NFT metadata from a hex-encoded URI.
 * Returns parsed name/image/description/attributes, or null if the URI
 * couldn't be resolved or the body isn't valid metadata. If the URI points
 * directly at an image (not JSON), only `imageUrl` is populated.
 */
export async function fetchMetadataFromHexUri(
  hexUri: string,
): Promise<ResolvedMetadata | null> {
  const rawUri = decodeHexUri(hexUri);
  if (!rawUri) return null;

  const isIpfs = resolveIpfsUri(rawUri) !== null;
  const isArweave =
    rawUri.startsWith("ar://") || extractArweavePath(rawUri) !== null;
  const resolved = resolveUri(rawUri);

  if (!resolved.startsWith("https://") && !isIpfs && !isArweave) return null;
  if (!isIpfs && !isArweave && !isAllowedUrl(resolved)) return null;

  const outerController = new AbortController();
  const outerTimeout = setTimeout(
    () => outerController.abort(),
    TOTAL_TIMEOUT,
  );

  try {
    const res = await fetchWithGatewayFallback(
      rawUri,
      "application/json, image/*, */*",
      outerController.signal,
    );
    clearTimeout(outerTimeout);
    if (!res) return null;

    const ct = res.headers.get("content-type") ?? "";

    if (ct.startsWith("image/")) {
      return {
        name: null,
        collectionName: null,
        imageUrl: res.url,
        description: null,
        attributes: null,
      };
    }

    const bodyText = await readBodySafe(res, MAX_SIZE);
    if (!bodyText) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      return null;
    }
    const validated = RawMetadataSchema.safeParse(parsed);
    if (!validated.success) return null;

    const data = validated.data;
    const image = extractString(data.image ?? data.animation_url);
    const name = extractString(data.name);
    const description = extractString(data.description);
    const collectionName = extractCollectionFromMetadata(data);

    const rawAttrs = Array.isArray(data.attributes)
      ? data.attributes
      : Array.isArray(data.properties)
        ? data.properties
        : null;
    const attributes = rawAttrs
      ? rawAttrs
          .filter(
            (a: unknown) =>
              a &&
              typeof a === "object" &&
              "trait_type" in (a as Record<string, unknown>) &&
              "value" in (a as Record<string, unknown>),
          )
          .map((a: Record<string, unknown>) => ({
            trait_type: String(a.trait_type),
            value:
              typeof a.value === "number" ? a.value : String(a.value ?? ""),
          }))
      : null;

    const rawImageUrl = image ? resolveUri(image) : null;
    const safeImageUrl =
      rawImageUrl &&
      (isAllowedUrl(rawImageUrl) || resolveIpfsUri(image ?? "") !== null)
        ? rawImageUrl
        : null;

    return {
      name: name ?? null,
      collectionName,
      imageUrl: safeImageUrl,
      description: description ?? null,
      attributes,
    };
  } catch {
    clearTimeout(outerTimeout);
    return null;
  }
}

/**
 * Pull a collection name out of the parsed metadata JSON. Tries a few
 * shapes that real-world metadata uses, falling through in priority
 * order:
 *
 *   1. `collection: "Foo Collection"`            (string)
 *   2. `collection: { name: "Foo Collection" }`  (OpenSea-style object)
 *   3. `collection_name: "Foo Collection"`       (snake-case alt)
 *   4. `properties.collection` / `properties.collection_name` (nested)
 *   5. **Description prefix** before a `:` or ` — ` separator, when
 *      the description starts with a phrase that looks like a
 *      collection name. Many XRPL collections (Pixel Ape Rowboat Club,
 *      various 10k drops) put the collection name there instead of in
 *      a dedicated field. Heuristic — relies on consensus across the
 *      collection to weed out per-NFT outliers.
 *
 * Returns `null` if none match — caller falls back to per-NFT-name
 * consensus (`pickCollectionName`).
 */
function extractCollectionFromMetadata(
  data: Record<string, unknown>,
): string | null {
  // Top-level `collection`: string or { name: string }
  const top = pickCollectionShape(data.collection);
  if (top) return top;

  // Top-level snake_case alternative
  const altSnake = extractString(data.collection_name);
  if (altSnake) return altSnake;

  // Nested under `properties` (Manifold + a few others)
  if (data.properties && typeof data.properties === "object") {
    const props = data.properties as Record<string, unknown>;
    const nested = pickCollectionShape(props.collection);
    if (nested) return nested;
    const nestedAlt = extractString(props.collection_name);
    if (nestedAlt) return nestedAlt;
  }

  // Description prefix fallback — see header doc.
  const desc = extractString(data.description);
  if (desc) {
    const prefix = extractCollectionFromDescription(desc);
    if (prefix) return prefix;
  }

  return null;
}

/** Pattern: leading non-empty phrase followed by `:` or ` — ` or ` - `,
 *  capped at 60 chars to avoid grabbing whole sentences. Examples that
 *  match:
 *    "Pixel Ape Rowboat Club: Generations. ..." → "Pixel Ape Rowboat Club"
 *    "Bored Ape #123 — limited edition" → null (the prefix has digit/hash)
 *    "Just a description" → null (no separator)
 *
 *  The cron's consensus over the whole collection is the safety net:
 *  if 14/15 NFTs extract the same prefix, it wins; if every NFT has a
 *  unique prefix, no consensus → falls through. */
function extractCollectionFromDescription(desc: string): string | null {
  // Drop common per-NFT-token-id fragments that pollute the prefix
  // (e.g. "Bored Ape #1234: ...").
  const sepMatch = desc.match(/^([^:]{2,60})[:—–-]\s/);
  if (!sepMatch) return null;
  const candidate = sepMatch[1].trim();
  // Reject if it carries numbering — that's the per-NFT name, not the
  // collection name.
  if (/[#0-9]/.test(candidate)) return null;
  // Reject pure single-word prefixes shorter than 3 chars (noise).
  if (candidate.length < 3) return null;
  return candidate;
}

/** Accept either `"Name"` or `{ name: "Name" }` shapes. */
function pickCollectionShape(field: unknown): string | null {
  if (typeof field === "string") return field.trim() || null;
  if (field && typeof field === "object") {
    const obj = field as Record<string, unknown>;
    const n = extractString(obj.name);
    if (n) return n;
  }
  return null;
}

// Re-exports from `nft-name-helpers` so existing server-side imports
// (the resolver, the metadata batch route, etc.) keep working. Pure
// string helpers live in the client-safe module.
export {
  extractCollectionName,
  pickCollectionName,
} from "./nft-name-helpers";
