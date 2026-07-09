/**
 * Alert delivery — dispatch alerts to in-app queue and webhooks.
 *
 * SSRF protection: validates webhook URLs against RFC 1918 private ranges,
 * localhost, and link-local addresses before making requests.
 */

import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import "@/db/schema";
import logger from "./logger";

const log = logger.child({ module: "alert-delivery" });

/* ── SSRF protection ── */

const BLOCKED_PATTERNS = [
  /^127\./,                   // localhost IPv4
  /^10\./,                    // RFC 1918 Class A
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC 1918 Class B
  /^192\.168\./,              // RFC 1918 Class C
  /^169\.254\./,              // link-local
  /^0\./,                     // "this" network
  /^::1$/,                    // localhost IPv6
  /^fc00:/i,                  // IPv6 unique local
  /^fe80:/i,                  // IPv6 link-local
];

function isPrivateIp(ip: string): boolean {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(ip));
}

async function validateWebhookUrl(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);

    // Block non-HTTPS
    if (parsed.protocol !== "https:") return false;

    // Block localhost hostnames
    const hostname = parsed.hostname.toLowerCase();
    if (hostname === "localhost" || hostname === "0.0.0.0" || hostname === "[::1]") return false;

    // DNS resolution check
    // In Node.js, we can use dns.promises.resolve to check the resolved IP
    const dns = await import("dns");
    const addresses = await new Promise<string[]>((resolve, reject) => {
      dns.resolve4(hostname, (err, addrs) => {
        if (err) reject(err);
        else resolve(addrs);
      });
    });

    for (const addr of addresses) {
      if (isPrivateIp(addr)) return false;
    }

    return true;
  } catch {
    return false;
  }
}

/* ── Delivery ── */

interface AlertRule {
  id: number;
  userAddress: string;
  type: string;
  conditionsJson: Record<string, unknown> | null;
}

export async function deliverAlert(
  historyId: number,
  rule: AlertRule,
  payload: Record<string, unknown>,
): Promise<void> {
  // In-app delivery is already handled by writing to alert_history
  // Just mark as delivered for in-app channel
  try {
    await db.execute(sql`
      UPDATE alert_history
      SET delivery_status = 'delivered'
      WHERE id = ${historyId} AND delivery_channel = 'in_app'
    `);
  } catch (err) {
    log.error({ err, historyId }, "Failed to mark in-app alert as delivered");
  }

  // Webhook delivery (if configured)
  const webhookUrl = rule.conditionsJson?.webhookUrl as string | undefined;
  if (!webhookUrl) return;

  const isValid = await validateWebhookUrl(webhookUrl);
  if (!isValid) {
    log.warn({ webhookUrl, ruleId: rule.id }, "Webhook URL failed SSRF validation");
    await db.execute(sql`
      UPDATE alert_history
      SET delivery_status = 'failed'
      WHERE id = ${historyId} AND delivery_channel = 'webhook'
    `);
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        alertId: historyId,
        ruleId: rule.id,
        type: rule.type,
        payload,
        timestamp: new Date().toISOString(),
      }),
      signal: AbortSignal.timeout(10_000), // 10s timeout
    });

    if (response.ok) {
      await db.execute(sql`
        UPDATE alert_history
        SET delivery_status = 'delivered'
        WHERE id = ${historyId}
      `);
    } else {
      log.warn({ status: response.status, ruleId: rule.id }, "Webhook delivery failed");
      await db.execute(sql`
        UPDATE alert_history
        SET delivery_status = 'failed', retry_count = retry_count + 1
        WHERE id = ${historyId}
      `);
    }
  } catch (err) {
    log.error({ err, ruleId: rule.id }, "Webhook delivery error");
    await db.execute(sql`
      UPDATE alert_history
      SET delivery_status = 'failed', retry_count = retry_count + 1
      WHERE id = ${historyId}
    `);
  }
}
