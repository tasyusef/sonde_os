import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { tokenMetadata } from "@/db/schema";
import { resolveTokenIcon } from "./xls-26-toml";
import { LRUCache } from "./cache";
import logger from "./logger";

const log = logger.child({ module: "token-icon-resolver" });

/**
 * Non-blocking XLS-26 icon resolver for newly-ingested tokens.
 *
 * Ingestion calls `queueTokenIconResolve` for every token pair it touched.
 * A small worker pool resolves icons via issuer TOML lookup and UPDATEs
 * token_metadata.icon — but only when it's still NULL, so we never clobber
 * a Bithomp-sourced or manually-curated icon.
 *
 * Design:
 * - Fire-and-forget from the caller: `queue` + `drain` schedule work
 *   without awaiting.
 * - Concurrency cap so a burst of new tokens doesn't open dozens of
 *   parallel issuer-TOML fetches.
 * - 6h LRU dedup window: once a pair has been attempted, we don't retry
 *   until the window expires. Combined with `isNull(icon)` guard in the
 *   UPDATE, this keeps load off third-party domains while still giving
 *   late-publishing issuers a chance to land.
 */

const MAX_CONCURRENT = 4;
const DEDUP_TTL_MS = 6 * 60 * 60 * 1000;

const recentAttempts = new LRUCache<boolean>(50_000, DEDUP_TTL_MS);
const queue: Array<{ currency: string; issuer: string }> = [];
let active = 0;

function keyOf(currency: string, issuer: string): string {
  return `${currency}|${issuer}`;
}

async function resolveOne(task: { currency: string; issuer: string }): Promise<void> {
  const { currency, issuer } = task;
  try {
    const icon = await resolveTokenIcon(currency, issuer);
    if (!icon) return;
    await db
      .update(tokenMetadata)
      .set({ icon, updatedAt: new Date() })
      .where(
        and(
          eq(tokenMetadata.currency, currency),
          eq(tokenMetadata.issuer, issuer),
          isNull(tokenMetadata.icon),
        ),
      );
    log.info({ currency, issuer, icon }, "token icon resolved");
  } catch (err) {
    log.debug({ err, currency, issuer }, "token icon resolve failed");
  }
}

function drain(): void {
  while (queue.length > 0 && active < MAX_CONCURRENT) {
    const next = queue.shift();
    if (!next) break;
    active++;
    resolveOne(next).finally(() => {
      active--;
      drain();
    });
  }
}

export function queueTokenIconResolve(currency: string, issuer: string): void {
  if (!issuer) return;
  const k = keyOf(currency, issuer);
  if (recentAttempts.has(k)) return;
  recentAttempts.set(k, true);
  queue.push({ currency, issuer });
  drain();
}

export function queueTokenIconResolveBatch(
  pairs: Iterable<{ currency: string; issuer: string }>,
): void {
  for (const { currency, issuer } of pairs) {
    queueTokenIconResolve(currency, issuer);
  }
}
