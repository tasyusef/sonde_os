/**
 * Find the mainnet activation ledger for every amendment in the registry.
 *
 * Approach: binary search per amendment against the on-chain `Amendments`
 * singleton ledger object. The transition ledger where an amendment moves
 * from "not in enabled set" to "in enabled set" is its activation ledger
 * (i.e., the ledger that contained the `EnableAmendment` pseudo-tx).
 *
 * Output: writes a JSON file at `scripts/data/amendment-activations.json`
 * with `{ amendmentId: { name, activationLedger, activationDate } }`.
 * Then it patches `src/lib/xrpl-amendments.ts` by emitting a TypeScript
 * snippet that you can paste in (or auto-replace; see below).
 *
 * Usage:
 *   pnpm exec tsx scripts/lookup-amendment-activations.ts
 *
 * Optional flags:
 *   --rippled <url>   default https://s1.ripple.com:51234/ (HTTP JSON-RPC)
 *   --concurrency 3   parallel binary searches (default 3, be polite)
 *   --update          auto-patch src/lib/xrpl-amendments.ts in place
 *
 * Doesn't touch our DB — read-only against public rippled. Safe to re-run.
 */

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { AMENDMENT_ACTIVATION } from "../src/lib/xrpl-amendments";

const RIPPLED_HTTP =
  process.argv.find((a) => a.startsWith("--rippled="))?.split("=", 2)[1] ??
  "https://s1.ripple.com:51234/";

const CONCURRENCY = parseInt(
  process.argv.find((a) => a.startsWith("--concurrency="))?.split("=", 2)[1] ?? "3",
  10,
);

const AUTO_UPDATE = process.argv.includes("--update");

/* The Amendments object's singleton ledger entry index. This is the same
   for every ledger — it's a fixed hash derived from the entry type. */
const AMENDMENTS_LEDGER_ENTRY =
  "7DB0788C020F02780A673DC74757F23823FA3014C1866E72CC4CD8B226CD6EF4";

/* XRPL epoch is 2000-01-01T00:00:00Z. Ledger close_time is seconds since. */
const XRPL_EPOCH_UNIX = 946684800;

interface RpcResponse<T> {
  result: T;
}

async function rpc<T>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(RIPPLED_HTTP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params: [params] }),
  });
  if (!res.ok) throw new Error(`RPC ${method} HTTP ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as RpcResponse<T> & { result: { error?: string; error_message?: string } };
  if (data.result?.error) {
    throw new Error(`RPC ${method} error: ${data.result.error_message ?? data.result.error}`);
  }
  return data.result as T;
}

interface ServerInfoResult {
  info: {
    validated_ledger: { seq: number };
    complete_ledgers: string;
  };
}

interface LedgerEntryResult {
  node?: { Amendments?: string[] };
  error?: string;
}

interface LedgerResult {
  ledger?: { ledger_index: number; close_time: number };
  error?: string;
}

async function getCurrentLedgerIndex(): Promise<number> {
  const info = await rpc<ServerInfoResult>("server_info", {});
  return info.info.validated_ledger.seq;
}

async function getAmendmentsAt(ledgerIndex: number): Promise<Set<string>> {
  const result = await rpc<LedgerEntryResult>("ledger_entry", {
    index: AMENDMENTS_LEDGER_ENTRY,
    ledger_index: ledgerIndex,
  });
  if (result.error) {
    // entryNotFound at very early ledgers is expected (no Amendments object yet)
    if (result.error === "entryNotFound") return new Set();
    throw new Error(`getAmendmentsAt(${ledgerIndex}): ${result.error}`);
  }
  return new Set(result.node?.Amendments ?? []);
}

async function getLedgerCloseTime(ledgerIndex: number): Promise<Date | null> {
  try {
    const result = await rpc<LedgerResult>("ledger", {
      ledger_index: ledgerIndex,
      transactions: false,
      expand: false,
    });
    if (!result.ledger) return null;
    const unix = result.ledger.close_time + XRPL_EPOCH_UNIX;
    return new Date(unix * 1000);
  } catch {
    return null;
  }
}

/**
 * Binary search the activation ledger for a given amendment ID.
 *
 * Invariants:
 *   - Amendment is NOT enabled at `low - 1` (or low is genesis).
 *   - Amendment IS enabled at `high`.
 * Returns the smallest ledger index where the amendment is enabled.
 */
async function findActivationLedger(
  amendmentId: string,
  low: number,
  high: number,
): Promise<number> {
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    const enabled = await getAmendmentsAt(mid);
    if (enabled.has(amendmentId)) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

/* Simple concurrency pool. */
async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function step() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => step()));
  return results;
}

async function main() {
  console.log(`[lookup-amendment-activations] rippled=${RIPPLED_HTTP} concurrency=${CONCURRENCY}`);

  const head = await getCurrentLedgerIndex();
  console.log(`[lookup-amendment-activations] current validated ledger: ${head.toLocaleString()}`);

  /* Verify each enabled amendment is actually present at head. Disabled
     amendments are skipped — no activation ledger to find. */
  const enabledAtHead = await getAmendmentsAt(head);
  console.log(`[lookup-amendment-activations] ${enabledAtHead.size} amendments enabled at head`);

  const targets = Object.entries(AMENDMENT_ACTIVATION)
    .filter(([, entry]) => entry.enabled)
    .map(([name, entry]) => ({ name, id: entry.id }));

  console.log(`[lookup-amendment-activations] looking up ${targets.length} enabled amendments`);

  const results = await runWithConcurrency(targets, CONCURRENCY, async (target, i) => {
    const startedAt = Date.now();
    /* If the amendment isn't actually enabled at head, registry is wrong —
       skip with a warning rather than fail. */
    if (!enabledAtHead.has(target.id)) {
      console.warn(
        `  [${i + 1}/${targets.length}] ${target.name}: NOT enabled at head despite registry — skipping`,
      );
      return { name: target.name, id: target.id, activationLedger: null as number | null, activationDate: null as string | null };
    }

    const activationLedger = await findActivationLedger(target.id, 1, head);
    const closeTime = await getLedgerCloseTime(activationLedger);
    const activationDate = closeTime ? closeTime.toISOString().slice(0, 10) : null;
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

    console.log(
      `  [${i + 1}/${targets.length}] ${target.name}: activation ledger ${activationLedger.toLocaleString()} (${activationDate ?? "?"}) [${elapsedSec}s]`,
    );

    return { name: target.name, id: target.id, activationLedger, activationDate };
  });

  /* Write the JSON output. */
  const dataDir = resolve(import.meta.dirname, "data");
  mkdirSync(dataDir, { recursive: true });
  const outputPath = resolve(dataDir, "amendment-activations.json");
  const json = results.reduce<
    Record<string, { name: string; id: string; activationLedger: number | null; activationDate: string | null }>
  >((acc, r) => {
    acc[r.name] = r;
    return acc;
  }, {});
  writeFileSync(outputPath, JSON.stringify(json, null, 2) + "\n");
  console.log(`\n[lookup-amendment-activations] wrote ${outputPath}`);

  /* Optionally auto-patch src/lib/xrpl-amendments.ts in place. */
  if (AUTO_UPDATE) {
    const srcPath = resolve(import.meta.dirname, "..", "src", "lib", "xrpl-amendments.ts");
    let src = readFileSync(srcPath, "utf-8");
    let patches = 0;
    for (const r of results) {
      if (r.activationLedger == null) continue;
      const ledgerStr = r.activationLedger.toString();
      const dateStr = r.activationDate;

      /* Replace `activationLedger: null` with the value, scoped to the
         right entry by anchoring on the unique amendment id. */
      const idMatch = src.match(
        new RegExp(`(${r.name}: \\{[^}]*?id: "${r.id}",[^}]*?activationLedger: )null`),
      );
      if (idMatch) {
        src = src.replace(idMatch[0], `${idMatch[1]}${ledgerStr}`);
        patches++;
      }
      if (dateStr) {
        const dateMatch = src.match(
          new RegExp(`(${r.name}: \\{[^}]*?id: "${r.id}",[^}]*?activationLedger: ${ledgerStr},[^}]*?activationDate: )(null|"[^"]*")`),
        );
        if (dateMatch) {
          src = src.replace(dateMatch[0], `${dateMatch[1]}"${dateStr}"`);
        }
      }
    }
    writeFileSync(srcPath, src);
    console.log(`[lookup-amendment-activations] patched ${patches} entries in src/lib/xrpl-amendments.ts`);
  } else {
    console.log(
      `[lookup-amendment-activations] re-run with --update to auto-patch src/lib/xrpl-amendments.ts`,
    );
  }
}

main().catch((err) => {
  console.error("[lookup-amendment-activations] fatal:", err);
  process.exit(1);
});
