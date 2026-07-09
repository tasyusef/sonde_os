import { NextRequest } from "next/server";
import { IPFS_GATEWAYS, isAllowedUrl, extractArweavePath, arweaveGatewayUrls } from "@/lib/nft-hosts";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const FETCH_TIMEOUT = 12_000; // 12 seconds per attempt
const TOTAL_TIMEOUT = 20_000; // hard ceiling across all gateway retries

/** Extract IPFS CID + path from any URL containing `/ipfs/<CID>`. This
 *  catches both known-good gateways AND third-party gateways (e.g.
 *  ipfs.firstledger.net) that intermittently 502 or fail SSL — once
 *  the path is extracted we re-route to our trusted gateway list. */
function extractIpfsPath(url: string): string | null {
  const m = url.match(/\/ipfs\/([^?#]+)/);
  return m ? m[1] : null;
}

/** Build gateway URLs for an IPFS path */
function ipfsGatewayUrls(ipfsPath: string): string[] {
  return IPFS_GATEWAYS.map((gw) => `${gw}${ipfsPath}`);
}

/** Safe Content-Type: only pass through image/* types */
function safeContentType(ct: string): string {
  const normalized = ct.split(";")[0].trim().toLowerCase();
  if (normalized.startsWith("image/")) return normalized;
  return "application/octet-stream";
}

async function fetchWithTimeout(
  url: string,
  outerSignal: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  // Forward outer deadline abort to this request
  outerSignal.addEventListener("abort", () => controller.abort(), {
    once: true,
  });

  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "manual" });
    clearTimeout(timeout);
    return res;
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/** Read body with a hard size cap, returns Uint8Array (guards against missing Content-Length) */
async function readBodySafe(
  res: Response,
  maxBytes: number
): Promise<ArrayBuffer | null> {
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

  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Return a standalone ArrayBuffer (safe — result owns its own buffer of exactly `total` bytes)
  return result.buffer as ArrayBuffer;
}

export async function GET(request: NextRequest) {
  const url = request.nextUrl.searchParams.get("url");
  if (!url) {
    return new Response("Missing url param", { status: 400 });
  }

  // HTTPS only — reject HTTP to prevent mixed content and SSRF to internal services
  if (!url.startsWith("https://")) {
    return new Response("Only HTTPS URLs are allowed", { status: 400 });
  }

  // Build URL list with gateway fallback for IPFS and Arweave
  const ipfsPath = extractIpfsPath(url);
  const arPath = extractArweavePath(url);
  if (!isAllowedUrl(url) && !ipfsPath && !arPath) {
    return new Response("Host not allowed", { status: 403 });
  }

  // Outer deadline across all gateway retries
  const outerController = new AbortController();
  const outerTimeout = setTimeout(
    () => outerController.abort(),
    TOTAL_TIMEOUT
  );

  try {
    const urls = ipfsPath
      ? ipfsGatewayUrls(ipfsPath)
      : arPath
        ? arweaveGatewayUrls(arPath)
        : [url];
    let lastError = "";

    for (const tryUrl of urls) {
      if (outerController.signal.aborted) break;
      try {
        const res = await fetchWithTimeout(tryUrl, outerController.signal);

        if (!res.ok) {
          lastError = `${res.status}`;
          continue; // Try next gateway
        }

        const ct =
          res.headers.get("content-type") ?? "application/octet-stream";

        // Read body with hard size cap (protects against missing Content-Length)
        const body = await readBodySafe(res, MAX_SIZE);
        if (!body) {
          return new Response("Image too large", { status: 502 });
        }

        clearTimeout(outerTimeout);
        return new Response(body, {
          headers: {
            "Content-Type": safeContentType(ct),
            "Cache-Control": "public, max-age=2592000, s-maxage=2592000, immutable",
            "Content-Length": body.byteLength.toString(),
          },
        });
      } catch {
        lastError = "timeout";
        // Try next gateway
      }
    }

    clearTimeout(outerTimeout);
    return new Response(`All sources failed: ${lastError}`, { status: 502 });
  } catch {
    clearTimeout(outerTimeout);
    return new Response("Failed to fetch image", { status: 502 });
  }
}
