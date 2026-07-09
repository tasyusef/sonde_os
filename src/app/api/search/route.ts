import { NextResponse, type NextRequest } from "next/server";
import { xrplClient } from "@/lib/xrpl-client";
import { transactionCache } from "@/lib/cache";
import { detectSearchType, parseAddressDT, XRPL_ADDRESS_RE } from "@/lib/xrpl-helpers";
import type { SearchResult, SearchType } from "@/types/search";
import logger from "@/lib/logger";

const log = logger.child({ module: "api/search" });

/**
 * Server-side search resolution for ambiguous inputs.
 *
 * Tier 1 (client-side) handles unambiguous patterns instantly.
 * This endpoint resolves:
 *   - hex64: tries TX cache → NFT → TX → ledger_entry (offer/escrow)
 *   - paystring: fetches PayString URL and extracts XRPL address
 *   - x-address: decodes to classic r-address server-side
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json(
      { type: "unknown", redirect: "", label: "Empty query" } satisfies SearchResult,
      { status: 400 }
    );
  }

  const searchType = detectSearchType(q);

  try {
    switch (searchType) {
      case "hex64":
        return NextResponse.json(await resolveHex64(q));

      case "ctid":
        return NextResponse.json(await resolveCTID(q));

      case "paystring":
        return NextResponse.json(await resolvePayString(q));

      case "x-address":
        return NextResponse.json(await resolveXAddress(q));

      default:
        // For types the client can handle directly, return their redirect
        return NextResponse.json(buildClientRedirect(searchType, q));
    }
  } catch (err) {
    log.error({ err }, "search resolution failed");
    return NextResponse.json(
      { type: "unknown", redirect: "", label: "Search failed" } satisfies SearchResult,
      { status: 500 }
    );
  }
}

/** Try TX cache → race NFT/TX/ledger-entry in parallel, pick by precedence */
async function resolveHex64(hash: string): Promise<SearchResult> {
  // Fast path: check transaction cache before any XRPL probes.
  if (transactionCache.has(hash)) {
    return { type: "transaction", redirect: `/tx/${hash}` };
  }

  // Race the three XRPL probes in parallel rather than serial — most
  // search queries don't match the first probe (NFTs are the rarest
  // input shape), so the prior NFT → TX → ledger sequence ate ~3× the
  // wall-clock for any miss. Header search bar is user-blocking, so
  // this latency is felt. Pick the first non-rejected result by the
  // same precedence: NFT > TX > ledger entry.
  const [nft, tx, entry] = await Promise.allSettled([
    xrplClient.getNFTInfo(hash),
    xrplClient.getTransaction(hash),
    xrplClient.getLedgerEntry(hash),
  ]);

  if (nft.status === "fulfilled") {
    return { type: "nft", redirect: `/nft/${hash}` };
  }
  if (tx.status === "fulfilled") {
    return { type: "transaction", redirect: `/tx/${hash}` };
  }
  if (entry.status === "fulfilled" && entry.value?.node) {
    const entryType = (entry.value.node.LedgerEntryType as string) ?? "Object";
    return {
      type: "ledger-object",
      redirect: "",
      label: `Found ${entryType} object (no viewer available)`,
    };
  }

  return { type: "unknown", redirect: "", label: "No match found" };
}

/** Decode CTID → ledger index + tx index, then fetch the transaction */
async function resolveCTID(ctid: string): Promise<SearchResult> {
  try {
    const hex = ctid.toUpperCase();
    const bytes = new Uint8Array(
      hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
    );
    const view = new DataView(bytes.buffer);
    const ledgerIndex = view.getUint32(0) & 0x0FFFFFFF;
    const txIndex = view.getUint16(4);
    // network_id = view.getUint16(6) — not needed for lookup

    // Fetch the ledger to get the transaction hash at that index
    const ledger = await xrplClient.getLedger(ledgerIndex, true);

    const txs = ledger.ledger.transactions;
    if (!txs || txIndex >= txs.length) {
      return { type: "unknown", redirect: "", label: "Transaction not found at CTID position" };
    }

    const txHash = txs[txIndex]?.hash;
    if (txHash) {
      return { type: "transaction", redirect: `/tx/${txHash}` };
    }

    return { type: "unknown", redirect: "", label: "Could not resolve CTID" };
  } catch {
    return { type: "unknown", redirect: "", label: "Invalid CTID" };
  }
}

/** Resolve a PayString (user$domain.com) to an XRPL address */
async function resolvePayString(paystring: string): Promise<SearchResult> {
  const dollarIdx = paystring.indexOf("$");
  const user = paystring.slice(0, dollarIdx);
  const domain = paystring.slice(dollarIdx + 1);

  // Block SSRF: reject private/internal domains and IP ranges.
  // Covers IPv4, IPv6 (including ::1, fc00:, fe80:, IPv4-mapped ::ffff:),
  // bracketed IPv6 literals, decimal IP notation (e.g. 2130706433), and
  // internal TLDs (.local, .internal).
  const blockedPatterns = /^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|::1|fc00:|fe80:|\[::1\]|::ffff:(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)|::ffff:0:|::ffff:169\.254\.|\d{8,10}$|.*\.local$|.*\.internal$)/i;
  if (blockedPatterns.test(domain)) {
    return { type: "unknown", redirect: "", label: "PayString domain not allowed" };
  }

  // Encode user to prevent query/fragment injection
  const url = `https://${domain}/${encodeURIComponent(user)}`;

  const response = await fetch(url, {
    headers: {
      Accept: "application/payid+json",
      "PayID-Version": "1.0",
    },
    signal: AbortSignal.timeout(5000),
    redirect: "error",
  });

  if (!response.ok) {
    return { type: "unknown", redirect: "", label: "PayString not found" };
  }

  const data = (await response.json()) as {
    addresses?: Array<{
      paymentNetwork?: string;
      environment?: string;
      addressDetails?: { address?: string };
    }>;
  };

  // Find the XRPL mainnet address
  const xrplAddr = data.addresses?.find(
    (a) =>
      a.paymentNetwork === "XRPL" && a.environment === "MAINNET"
  );

  const addr = xrplAddr?.addressDetails?.address;

  // Validate the resolved address against the XRPL r-address format
  if (addr && XRPL_ADDRESS_RE.test(addr)) {
    return {
      type: "account",
      redirect: `/account/${addr}`,
      label: paystring,
    };
  }

  return { type: "unknown", redirect: "", label: "No XRPL address in PayString" };
}

/** Decode X-address to classic r-address server-side */
async function resolveXAddress(xaddr: string): Promise<SearchResult> {
  try {
    const xrpl = await import("xrpl");
    const decoded = xrpl.xAddressToClassicAddress(xaddr);
    return {
      type: "account",
      redirect: `/account/${decoded.classicAddress}`,
      label: xaddr,
    };
  } catch {
    return { type: "unknown", redirect: "", label: "Invalid X-address" };
  }
}

/** Build redirect for types the client could handle but sent to server anyway */
function buildClientRedirect(type: SearchType, q: string): SearchResult {
  switch (type) {
    case "account":
      return { type, redirect: `/account/${q}` };
    case "account-dt": {
      const parsed = parseAddressDT(q);
      if (parsed) {
        return { type, redirect: `/account/${parsed.address}?dt=${parsed.dt}` };
      }
      return { type: "unknown", redirect: "", label: "Invalid address:tag format" };
    }
    case "ledger":
      return { type, redirect: `/ledger/${q}` };
    case "currency-hash":
    case "currency-code":
      return { type, redirect: `/markets?search=${encodeURIComponent(q)}` };
    default:
      return { type: "unknown", redirect: "", label: "Unrecognized input" };
  }
}
