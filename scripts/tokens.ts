/**
 * Build the token list the search box matches tickers against
 * (`src/data/tokens.json`, read by `lib/token-list`), from XRPL Meta's
 * token index (https://xrplmeta.org, no key). Only tokens with at least
 * `MIN_HOLDERS` holders: below that it's mostly dead or spam. Rerun now
 * and then; the pages themselves read the ledger live.
 *
 * Usage:
 *   pnpm tokens
 */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isValidClassicAddress } from "ripple-address-codec";
import { z } from "zod";
import { currencyCode, isLedgerCurrency, isLpCurrency, isMptId } from "../src/lib/token-id";
import type { TokenListEntry, TokenListFile } from "../src/lib/token-list";

const API = "https://s1.xrplmeta.org/v2/tokens";
const PAGE = 1000;
const MIN_HOLDERS = 100;
/** MPTs are new and few: any with a holder and a ticker. */
const MIN_MPT_HOLDERS = 1;
const MAX_PAGES = 20;
const OUT = join(resolve(import.meta.dirname, ".."), "src/data/tokens.json");

const text = z.string().optional().catch(undefined);
const Token = z.object({
  currency: z.string().optional(),
  mpt_issuance_id: z.string().optional(),
  issuer: z.string(),
  meta: z
    .object({
      token: z.object({ name: text, ticker: text, trust_level: z.number().optional().catch(undefined) }).partial().optional(),
      issuer: z.object({ name: text, domain: text }).partial().optional(),
    })
    .optional(),
  // XRPL Meta reports a few negative counts.
  metrics: z.object({ holders: z.number().int().nonnegative().catch(0) }),
});
const Page = z.object({ tokens: z.array(Token) });
type Token = z.infer<typeof Token>;

async function page(kind: "iou" | "mpt", offset: number): Promise<Token[]> {
  const url = `${API}/${kind}?sort_by=holders&limit=${PAGE}&offset=${offset}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return Page.parse(await res.json()).tokens;
    } catch (err) {
      if (attempt === 3 || err instanceof z.ZodError) throw new Error(`${url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** Pages sorted by holders, until they drop below `min`. */
async function fetchAll(kind: "iou" | "mpt", min: number): Promise<Token[]> {
  const all: Token[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const tokens = await page(kind, i * PAGE);
    all.push(...tokens.filter((t) => t.metrics.holders >= min));
    if (tokens.length < PAGE || tokens.at(-1)!.metrics.holders < min) break;
  }
  return all;
}

/** Printable, trimmed, at most 64 chars; undefined when empty. */
function clean(s: string | undefined): string | undefined {
  const out = s?.replace(/\p{Cc}/gu, "").trim().slice(0, 64);
  return out || undefined;
}

/** A bare host name. XRPL Meta gives some as URLs. The hosts First Ledger
 *  makes up for its tokens' TOML files say nothing, so they're dropped. */
function domain(s: string | undefined): string | undefined {
  const host = s
    ?.trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/^www\./, "");
  if (!host || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) || host.endsWith(".toml.firstledger.net")) return undefined;
  return host;
}

function entry(t: Token): TokenListEntry | null {
  if (!isValidClassicAddress(t.issuer)) return null;
  const name = clean(t.meta?.token?.name);
  const base = {
    i: t.issuer,
    h: t.metrics.holders,
    t: t.meta?.token?.trust_level || undefined,
    in: clean(t.meta?.issuer?.name),
    d: domain(t.meta?.issuer?.domain),
  };
  if (t.mpt_issuance_id) {
    const ticker = clean(t.meta?.token?.ticker)?.slice(0, 16);
    if (!isMptId(t.mpt_issuance_id) || !ticker) return null;
    return { m: t.mpt_issuance_id.toUpperCase(), c: ticker, n: name, ...base };
  }
  const currency = t.currency;
  if (!currency || !isLedgerCurrency(currency) || isLpCurrency(currency)) return null;
  const c = currencyCode(currency);
  return { c, n: name?.toLowerCase() === c.toLowerCase() ? undefined : name, ...base };
}

const [ious, mpts] = await Promise.all([fetchAll("iou", MIN_HOLDERS), fetchAll("mpt", MIN_MPT_HOLDERS)]);
const tokens = [...ious, ...mpts]
  .map(entry)
  .filter((e): e is TokenListEntry => e !== null)
  .sort((a, b) => b.h - a.h);
const file: TokenListFile = { made: new Date().toISOString().slice(0, 10), tokens };
writeFileSync(OUT, `${JSON.stringify(file)}\n`);
console.log(`${tokens.length} tokens (${tokens.filter((t) => t.m).length} MPTs) → src/data/tokens.json`);
