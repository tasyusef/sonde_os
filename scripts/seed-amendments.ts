/**
 * One-shot seed script — fetches current amendment state from the XRPL
 * `feature` command and writes it to Postgres so the UI isn't blank.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." npx tsx scripts/seed-amendments.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { sql } from "drizzle-orm";
import {
  amendments,
  amendmentVotes,
} from "../src/db/schema/amendments";

/* ------------------------------------------------------------------ */
/*  Config                                                             */
/* ------------------------------------------------------------------ */

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const XRPL_NODES = [
  "wss://s2.ripple.com",
  "wss://honeycluster.io",
  "wss://xrplcluster.com",
  "wss://s1.ripple.com",
];

/* ------------------------------------------------------------------ */
/*  Minimal WebSocket RPC                                              */
/* ------------------------------------------------------------------ */

async function xrplSend(
  command: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  // Dynamic import for ws (Node.js WebSocket)
  const { default: WebSocket } = await import("ws");

  for (const url of XRPL_NODES) {
    try {
      const result = await new Promise<Record<string, unknown> | null>(
        (resolve, reject) => {
          const ws = new WebSocket(url);
          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error(`Timeout connecting to ${url}`));
          }, 10_000);

          ws.on("open", () => {
            ws.send(JSON.stringify({ ...command, id: 1 }));
          });

          ws.on("message", (data: Buffer) => {
            clearTimeout(timeout);
            const parsed = JSON.parse(data.toString());
            ws.close();
            if (parsed.result) {
              resolve(parsed.result as Record<string, unknown>);
            } else {
              resolve(null);
            }
          });

          ws.on("error", (err: Error) => {
            clearTimeout(timeout);
            ws.close();
            reject(err);
          });
        },
      );

      if (result) return result;
    } catch (err) {
      console.warn(`[seed] ${url} failed:`, (err as Error).message);
    }
  }

  return null;
}

/* ------------------------------------------------------------------ */
/*  Fetch & seed                                                       */
/* ------------------------------------------------------------------ */

interface FeatureInfo {
  name: string;
  enabled: boolean;
  supported?: boolean;
  count?: number;
  threshold?: number;
  validations?: number;
}

async function main() {
  console.log("[seed] Fetching amendments from XRPL...");

  const result = await xrplSend({ command: "feature" });
  if (!result) {
    console.error("[seed] Failed to fetch from all XRPL nodes");
    process.exit(1);
  }

  // The `feature` response nests amendments under `result.features`
  const features = (result.features ?? result) as Record<string, unknown>;

  const snapshots: {
    hash: string;
    name: string;
    enabled: boolean;
    yesCount: number;
    threshold: number;
    totalValidators: number;
    hasMajority: boolean;
  }[] = [];

  for (const [hash, raw] of Object.entries(features)) {
    const info = raw as FeatureInfo;
    if (!info.name || typeof info.enabled !== "boolean") continue;

    const hasVoteCounts =
      info.count !== undefined && info.validations !== undefined;

    snapshots.push({
      hash,
      name: info.name,
      enabled: info.enabled,
      yesCount: hasVoteCounts ? (info.count ?? 0) : 0,
      threshold: hasVoteCounts ? (info.threshold ?? 0) : 0,
      totalValidators: hasVoteCounts ? (info.validations ?? 0) : 0,
      hasMajority: hasVoteCounts
        ? (info.count ?? 0) >= (info.threshold ?? 1)
        : false,
    });
  }

  console.log(
    `[seed] Found ${snapshots.length} amendments (${snapshots.filter((s) => s.enabled).length} enabled, ${snapshots.filter((s) => !s.enabled).length} pending)`,
  );

  if (snapshots.length === 0) {
    console.error("[seed] No amendments found");
    process.exit(1);
  }

  // Connect to DB
  const client = postgres(DATABASE_URL!);
  const seedDb = drizzle(client);
  const now = new Date();

  console.log("[seed] Writing to database...");

  await seedDb.transaction(async (tx) => {
    for (const snap of snapshots) {
      // Upsert amendment metadata
      await tx
        .insert(amendments)
        .values({
          hash: snap.hash,
          name: snap.name,
          enabled: snap.enabled,
          enabledAt: snap.enabled ? now : null,
        })
        .onConflictDoUpdate({
          target: amendments.hash,
          set: {
            name: snap.name,
            enabled: snap.enabled,
            enabledAt: snap.enabled
              ? sql`COALESCE(${amendments.enabledAt}, ${now.toISOString()})`
              : sql`${amendments.enabledAt}`,
            updatedAt: now,
          },
        });

      // Record vote snapshot for non-enabled amendments
      if (!snap.enabled && snap.totalValidators > 0) {
        await tx
          .insert(amendmentVotes)
          .values({
            amendmentHash: snap.hash,
            recordedAt: now,
            yesCount: snap.yesCount,
            threshold: snap.threshold,
            totalValidators: snap.totalValidators,
            hasMajority: snap.hasMajority,
          })
          .onConflictDoNothing();
      }
    }
  });

  const pending = snapshots.filter((s) => !s.enabled);
  const withVotes = pending.filter((s) => s.totalValidators > 0);

  console.log(`[seed] Done!`);
  console.log(`  - ${snapshots.filter((s) => s.enabled).length} enabled amendments`);
  console.log(`  - ${pending.length} pending amendments`);
  console.log(`  - ${withVotes.length} with vote snapshots`);

  await client.end();
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed] Fatal error:", err);
  process.exit(1);
});
