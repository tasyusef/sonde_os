/**
 * AlertEngine — evaluates alert rules against live data.
 *
 * Subscribes to LiveDataManager as a permanent callback.
 * Per-ledger evaluation for watchlist_activity and anomaly_spike.
 * Periodic evaluation (5-min interval) for whale_movement and token_health_drop.
 *
 * Never blocks SSE broadcast. All evaluation is async.
 */

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { alertRules, alertHistory } from "@/db/schema";
import { liveDataManager, type LiveDataSnapshot } from "./live-data";
import { detectAnomalies } from "./anomaly-detection";
import { deliverAlert } from "./alert-delivery";
import { LRUCache } from "./cache";
import logger from "./logger";

const log = logger.child({ module: "alert-engine" });

/* ── Types ── */

type AlertType = "whale_movement" | "anomaly_spike" | "watchlist_activity" | "token_health_drop" | "smart_money_trade";

interface AlertRule {
  id: number;
  userAddress: string;
  type: AlertType;
  conditionsJson: Record<string, unknown> | null;
  lastTriggeredAt: Date | null;
}

/* ── Rule cache (60s per user) ── */
const rulesCache = new LRUCache<AlertRule[]>(200, 60_000);

async function getEnabledRules(): Promise<AlertRule[]> {
  const cacheKey = "all_enabled";
  const cached = rulesCache.get(cacheKey);
  if (cached) return cached;

  const rows = await db
    .select({
      id: alertRules.id,
      userAddress: alertRules.userAddress,
      type: alertRules.type,
      conditionsJson: alertRules.conditionsJson,
      lastTriggeredAt: alertRules.lastTriggeredAt,
    })
    .from(alertRules)
    .where(sql`${alertRules.enabled} = TRUE`);

  const rules = rows.map((r) => ({
    ...r,
    type: r.type as AlertType,
    conditionsJson: r.conditionsJson as Record<string, unknown> | null,
  }));

  rulesCache.set(cacheKey, rules);
  return rules;
}

/** Invalidate cache when rules change (called from API routes) */
export function invalidateRulesCache(): void {
  rulesCache.delete("all_enabled");
}

/* ── Cooldown tracking (1h per rule+entity) ── */
const cooldowns = new Map<string, number>();
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

function isOnCooldown(ruleId: number, entityKey: string): boolean {
  const key = `${ruleId}:${entityKey}`;
  const lastFired = cooldowns.get(key);
  if (!lastFired) return false;
  return Date.now() - lastFired < COOLDOWN_MS;
}

function setCooldown(ruleId: number, entityKey: string): void {
  cooldowns.set(`${ruleId}:${entityKey}`, Date.now());
  // Prune old cooldowns every 1000 entries
  if (cooldowns.size > 1000) {
    const cutoff = Date.now() - COOLDOWN_MS;
    for (const [k, v] of cooldowns) {
      if (v < cutoff) cooldowns.delete(k);
    }
  }
}

/* ── Alert trigger helper ── */

async function triggerAlert(
  rule: AlertRule,
  entityKey: string,
  payload: Record<string, unknown>,
): Promise<void> {
  if (isOnCooldown(rule.id, entityKey)) return;

  try {
    const [inserted] = await db
      .insert(alertHistory)
      .values({
        ruleId: rule.id,
        payloadJson: payload,
        deliveryChannel: "in_app",
      })
      .returning({ id: alertHistory.id });

    // Update last triggered timestamp on rule
    await db.execute(sql`
      UPDATE alert_rules SET last_triggered_at = NOW() WHERE id = ${rule.id}
    `);

    setCooldown(rule.id, entityKey);

    // Attempt delivery (non-blocking)
    deliverAlert(inserted.id, rule, payload).catch((err) =>
      log.error({ err, ruleId: rule.id }, "Alert delivery failed"),
    );
  } catch (err) {
    log.error({ err, ruleId: rule.id }, "Failed to write alert");
  }
}

/* ── Per-ledger evaluation ── */

async function evaluatePerLedger(snapshot: LiveDataSnapshot): Promise<void> {
  let rules: AlertRule[];
  try {
    rules = await getEnabledRules();
  } catch {
    return; // DB unavailable — skip silently
  }

  if (rules.length === 0) return;

  // ── Watchlist Activity ──
  const watchlistRules = rules.filter((r) => r.type === "watchlist_activity");
  if (watchlistRules.length > 0 && snapshot.transactions.length > 0) {
    // Build set of all addresses involved in this ledger's transactions
    const involvedAddresses = new Set<string>();
    for (const tx of snapshot.transactions) {
      if (tx.account) involvedAddresses.add(tx.account);
      if (tx.destination) involvedAddresses.add(tx.destination);
    }

    for (const rule of watchlistRules) {
      const watchedAddresses = (rule.conditionsJson?.addresses as string[]) ?? [];
      for (const addr of watchedAddresses) {
        if (involvedAddresses.has(addr)) {
          await triggerAlert(rule, addr, {
            type: "watchlist_activity",
            address: addr,
            ledgerIndex: snapshot.ledger.ledger_index,
            message: `Watched address ${addr.slice(0, 8)}...${addr.slice(-4)} transacted`,
          });
        }
      }
    }
  }

  // ── Anomaly Spike ──
  const anomalyRules = rules.filter((r) => r.type === "anomaly_spike");
  if (anomalyRules.length > 0) {
    try {
      const anomalies = await detectAnomalies();
      const significant = anomalies.filter(
        (a) => a.severity === "significant" || a.severity === "extreme",
      );

      if (significant.length > 0) {
        for (const rule of anomalyRules) {
          for (const anomaly of significant) {
            await triggerAlert(rule, anomaly.metric, {
              type: "anomaly_spike",
              metric: anomaly.metric,
              severity: anomaly.severity,
              zScore: anomaly.zScore,
              message: `${anomaly.metric} anomaly detected (${anomaly.severity})`,
            });
          }
        }
      }
    } catch {
      // Anomaly detection failed — skip
    }
  }
}

/* ── Periodic evaluation (5-min interval) ── */

async function evaluatePeriodic(): Promise<void> {
  let rules: AlertRule[];
  try {
    rules = await getEnabledRules();
  } catch {
    return;
  }

  // ── Token Health Drop ──
  const healthRules = rules.filter((r) => r.type === "token_health_drop");
  if (healthRules.length > 0) {
    const { computeTokenHealth } = await import("./token-health");

    for (const rule of healthRules) {
      const currency = rule.conditionsJson?.currency as string | undefined;
      const issuer = rule.conditionsJson?.issuer as string | undefined;
      const threshold = Number(rule.conditionsJson?.threshold) || 50;

      if (!currency || !issuer) continue;

      try {
        const health = await computeTokenHealth(currency, issuer);
        if (health.compositeScore >= 0 && health.compositeScore < threshold) {
          await triggerAlert(rule, `${currency}:${issuer}`, {
            type: "token_health_drop",
            currency,
            issuer,
            score: health.compositeScore,
            threshold,
            message: `${currency} health score dropped to ${health.compositeScore} (below ${threshold})`,
          });
        }
      } catch {
        // Token health computation failed — skip
      }
    }
  }

  // ── Whale Movement ──
  const whaleRules = rules.filter((r) => r.type === "whale_movement");
  if (whaleRules.length > 0) {
    const { getWhaleActivity } = await import("./whale-activity");

    for (const rule of whaleRules) {
      const currency = rule.conditionsJson?.currency as string | undefined;
      const issuer = rule.conditionsJson?.issuer as string | undefined;
      if (!currency || !issuer) continue;

      try {
        const activity = await getWhaleActivity(currency, issuer, "24h");
        const significant = activity.events.filter(
          (e) => e.type === "new_entry" || e.type === "exit" || Math.abs(e.delta) > 0,
        );

        if (significant.length > 0) {
          const top = significant[0];
          await triggerAlert(rule, `${currency}:${issuer}:${top.holderAddress}`, {
            type: "whale_movement",
            currency,
            issuer,
            address: top.holderAddress,
            eventType: top.type,
            delta: top.delta,
            message: `Whale ${top.type}: ${top.holderAddress.slice(0, 8)}...${top.holderAddress.slice(-4)} ${top.type === "accumulation" ? "bought" : "sold"} ${currency}`,
          });
        }
      } catch {
        // Whale activity fetch failed — skip
      }
    }
  }
  // ── Smart Money Trade ──
  const smtRules = rules.filter((r) => r.type === "smart_money_trade");
  if (smtRules.length > 0) {
    const { readOnlyQuery } = await import("./clickhouse-client");

    for (const rule of smtRules) {
      const addresses = (rule.conditionsJson?.addresses as string[]) ?? [];
      const direction = (rule.conditionsJson?.direction as string) ?? "any";
      const minVolume = Number(rule.conditionsJson?.minVolumeDrops) || 0;

      if (addresses.length === 0) continue;

      try {
        // SECURITY: addresses are user-controlled (Pro-tier rule conditions).
        // Pre-2026-05-05 this used `addresses.map(a => \`'${a}'\`).join(",")`
        // which was injectable — a hostile address payload like
        // `x') OR 1=1 UNION SELECT * FROM ...` broke out of the WHERE.
        // Parameterized array via {addresses:Array(String)} is safe; the
        // /api/intel/alerts POST/PUT handlers also validate each address
        // against XRPL_ADDRESS_RE at write-time as defense in depth.
        const rows = await readOnlyQuery(
          `SELECT tx_hash, timestamp, taker, maker, base_currency, base_issuer,
                  base_amount, quote_currency, price, xrp_volume_drops
           FROM dex_trades
           WHERE (taker IN {addresses:Array(String)} OR maker IN {addresses:Array(String)})
             AND timestamp > now() - INTERVAL 5 MINUTE
           ORDER BY timestamp DESC
           LIMIT 10`,
          { addresses },
        );

        for (const row of rows) {
          // xrp_volume_drops is CH Int64 → arrives as decimal string via
          // JSONEachRow (>2^53 capable). The Number() cast on line 302 is
          // fine here because minVolume comparisons are display-grade — we
          // care about thresholds in the millions/billions of drops, well
          // within Number safe range.
          const r = row as {
            tx_hash: string; taker: string; maker: string;
            base_currency: string; base_issuer: string;
            base_amount: number; price: number; xrp_volume_drops: string;
          };

          const wallet = addresses.includes(r.taker) ? r.taker : r.maker;
          const isBuy = wallet === r.taker;
          const dir = isBuy ? "buy" : "sell";

          // Direction filter
          if (direction !== "any" && direction !== dir) continue;
          // Volume filter
          if (minVolume > 0 && Math.abs(Number(r.xrp_volume_drops)) < minVolume) continue;

          await triggerAlert(rule, `${wallet}:${r.tx_hash}`, {
            type: "smart_money_trade",
            wallet,
            token: r.base_currency,
            issuer: r.base_issuer,
            direction: dir,
            amount: Number(r.base_amount),
            price: Number(r.price),
            txHash: r.tx_hash,
            message: `${wallet.slice(0, 8)}...${wallet.slice(-4)} ${dir === "buy" ? "bought" : "sold"} ${Number(r.base_amount).toFixed(2)} ${r.base_currency}`,
          });
        }
      } catch {
        // ClickHouse query failed — skip
      }
    }
  }
}

/* ── Init ── */

let initialized = false;
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained for future cleanup/shutdown
let periodicInterval: ReturnType<typeof setInterval> | null = null;

export function initAlertEngine(): void {
  if (initialized) return;
  initialized = true;

  log.info("AlertEngine: initialized");

  // Subscribe to LiveDataManager for per-ledger evaluation
  liveDataManager.subscribe((snapshot) => {
    // Fire-and-forget — never block the broadcast
    evaluatePerLedger(snapshot).catch((err) =>
      log.error({ err }, "AlertEngine: per-ledger evaluation error"),
    );
  });

  // Periodic evaluation every 5 minutes (whale movement, token health)
  periodicInterval = setInterval(() => {
    evaluatePeriodic().catch((err) =>
      log.error({ err }, "AlertEngine: periodic evaluation error"),
    );
  }, 5 * 60 * 1000);

  // Run periodic evaluation once on startup
  evaluatePeriodic().catch((err) =>
    log.error({ err }, "AlertEngine: startup periodic evaluation error"),
  );
}
