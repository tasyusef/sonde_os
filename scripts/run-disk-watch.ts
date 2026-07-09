/**
 * Disk-pressure watchdog. Reads `df -h /`, classifies usage into a
 * tier, and notifies on UPWARD tier transitions only (so we don't
 * spam the channel every 5 minutes during an incident).
 *
 * Triggered by `sonde-disk-watch.timer` every 5 min on Hetzner.
 *
 * Tier model:
 *   ok        < 80%   no alert
 *   warning  80–89%   "getting tight"
 *   critical 90–94%   "fix in the next few hours"
 *   emergency ≥ 95%   "fix now"
 *
 * Re-alert rules:
 *   - Tier goes UP (e.g. warning→critical): alert
 *   - Tier stays the same: silent
 *   - Tier goes DOWN: silent for the alert channel, but state advances
 *     so a future re-cross fires
 *   - Drops to ok: clears state so the next warning is a fresh alert
 *
 * State persisted in `ingestion_state.disk_watch_last_tier`. Idempotent
 * across restarts.
 *
 * Notification channels:
 *   - Always: pino-style log line at INFO/WARN/ERROR levels.
 *   - Optional: HTTPS POST to OPS_WEBHOOK_URL (Discord-compatible JSON
 *     body; Slack incoming webhooks also accept the same shape with
 *     minor truncation). Webhook URL is validated against private IP
 *     ranges before request to mirror the SSRF discipline in
 *     src/lib/alert-delivery.ts.
 *
 * Usage (local):
 *   pnpm tsx scripts/run-disk-watch.ts
 *
 * Required env: DATABASE_URL.
 * Optional env: OPS_WEBHOOK_URL  (Discord/Slack incoming webhook URL)
 *               DISK_PATH         (mount point, default "/")
 */

import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { execFileSync } from "node:child_process";
import { sql } from "drizzle-orm";
import { db, client as pgClient } from "@/db";
import { ingestionState } from "@/db/schema";
import logger from "@/lib/logger";

const log = logger.child({ module: "disk-watch" });

const DISK_PATH = process.env.DISK_PATH ?? "/";
const WEBHOOK_URL = process.env.OPS_WEBHOOK_URL ?? null;
const STATE_KEY = "disk_watch_last_tier";

type Tier = "ok" | "warning" | "critical" | "emergency";

interface DiskState {
  total: number;
  used: number;
  available: number;
  percent: number;
}

const TIER_RANK: Record<Tier, number> = {
  ok: 0,
  warning: 1,
  critical: 2,
  emergency: 3,
};

function classify(percent: number): Tier {
  if (percent >= 95) return "emergency";
  if (percent >= 90) return "critical";
  if (percent >= 80) return "warning";
  return "ok";
}

function readDisk(): DiskState {
  // -P: POSIX-portable output (single-line per FS).
  // -k: report in 1K blocks so the math is integer + simple.
  const raw = execFileSync("df", ["-Pk", DISK_PATH], { encoding: "utf8" });
  const lines = raw.trim().split("\n");
  if (lines.length < 2) {
    throw new Error(`df output unexpected: ${raw}`);
  }
  // Header: Filesystem 1024-blocks Used Available Capacity Mounted on
  const fields = lines[1].split(/\s+/);
  const total = parseInt(fields[1], 10) * 1024;
  const used = parseInt(fields[2], 10) * 1024;
  const available = parseInt(fields[3], 10) * 1024;
  const percent = (used / total) * 100;
  return { total, used, available, percent };
}

function fmtGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function fmtPct(percent: number): string {
  return `${percent.toFixed(1)}%`;
}

/* ── Webhook delivery — Discord-compatible body, mirrors the SSRF
 *    discipline from src/lib/alert-delivery.ts (block private IPs,
 *    require https). Failures are logged and swallowed — never let a
 *    flaky webhook stop disk monitoring. ───────────────────────── */

const PRIVATE_IP = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
];

function isPrivateOrLoopback(host: string): boolean {
  const h = host.toLowerCase();
  if (h === "localhost" || h === "::1" || h === "0.0.0.0") return true;
  return PRIVATE_IP.some((p) => p.test(h));
}

const TIER_COLOR: Record<Tier, number> = {
  ok: 0x57f287,         // green
  warning: 0xfee75c,    // yellow
  critical: 0xeb6b22,   // orange
  emergency: 0xed4245,  // red
};

async function postWebhook(tier: Tier, disk: DiskState): Promise<void> {
  if (!WEBHOOK_URL) return;
  let parsed: URL;
  try {
    parsed = new URL(WEBHOOK_URL);
  } catch {
    log.warn("OPS_WEBHOOK_URL is not a valid URL — skipping notify");
    return;
  }
  if (parsed.protocol !== "https:") {
    log.warn("OPS_WEBHOOK_URL must be https — skipping notify");
    return;
  }
  if (isPrivateOrLoopback(parsed.hostname)) {
    log.warn({ host: parsed.hostname }, "OPS_WEBHOOK_URL points at a private host — skipping notify");
    return;
  }

  const title = `[Sonde / Hetzner] disk ${tier.toUpperCase()}`;
  const body = `${fmtPct(disk.percent)} used · ${fmtGb(disk.used)} of ${fmtGb(disk.total)} · ${fmtGb(disk.available)} free on \`${DISK_PATH}\``;
  const payload = {
    // Discord incoming-webhook fields. Slack incoming-webhooks also
    // accept `content` as a plain-text fallback, so this body works
    // either way without per-channel branching.
    content: `**${title}**\n${body}`,
    embeds: [
      {
        title,
        description: body,
        color: TIER_COLOR[tier],
        timestamp: new Date().toISOString(),
      },
    ],
  };

  try {
    const res = await fetch(parsed.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      log.warn({ status: res.status }, "Webhook POST returned non-2xx");
    }
  } catch (err) {
    log.warn({ err }, "Webhook POST failed (swallowed — not blocking watcher)");
  }
}

/* ── State persistence in ingestion_state (same table the other timers use). */

async function getLastTier(): Promise<Tier> {
  const rows = await db
    .select({ value: ingestionState.value })
    .from(ingestionState)
    .where(sql`${ingestionState.key} = ${STATE_KEY}`)
    .limit(1);
  const stored = rows[0]?.value;
  if (stored && stored in TIER_RANK) return stored as Tier;
  return "ok";
}

async function setLastTier(tier: Tier): Promise<void> {
  await db.insert(ingestionState)
    .values({ key: STATE_KEY, value: tier })
    .onConflictDoUpdate({
      target: ingestionState.key,
      set: { value: tier, updatedAt: new Date() },
    });
}

/* ── Main ──────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }

  const disk = readDisk();
  const tier = classify(disk.percent);
  const lastTier = await getLastTier();

  const summary = {
    path: DISK_PATH,
    percent: Number(disk.percent.toFixed(2)),
    used_gb: Number((disk.used / 1024 ** 3).toFixed(1)),
    free_gb: Number((disk.available / 1024 ** 3).toFixed(1)),
    tier,
    last_tier: lastTier,
  };

  if (TIER_RANK[tier] > TIER_RANK[lastTier]) {
    // Upward transition — alert.
    const fn = tier === "emergency" || tier === "critical" ? log.error : log.warn;
    fn.call(log, summary, "Disk pressure tier increased — alerting");
    await postWebhook(tier, disk);
    await setLastTier(tier);
  } else if (TIER_RANK[tier] < TIER_RANK[lastTier]) {
    // Downward transition — silent on the channel but advance state so
    // a future re-cross fires fresh.
    log.info(summary, "Disk pressure tier dropped — clearing alert state");
    await setLastTier(tier);
  } else {
    // Same tier — quiet log.
    log.info(summary, "Disk pressure check");
  }
}

main()
  .then(() => pgClient.end().catch(() => undefined))
  .then(() => process.exit(0))
  .catch((err) => {
    log.error({ err }, "[disk-watch] fatal");
    pgClient.end().catch(() => undefined);
    process.exit(1);
  });
