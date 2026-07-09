import { pgTable, serial, varchar, boolean, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";

/** Alert rules — user-configured preset alerts */
export const alertRules = pgTable(
  "alert_rules",
  {
    id: serial("id").primaryKey(),
    userAddress: varchar("user_address", { length: 35 }).notNull(),
    type: varchar("type", { length: 40 }).notNull(), // whale_movement, anomaly_spike, watchlist_activity, token_health_drop
    conditionsJson: jsonb("conditions_json"), // e.g. { token: "USD/rIssuer", threshold: 50 }
    enabled: boolean("enabled").notNull().default(true),
    lastTriggeredAt: timestamp("last_triggered_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_alert_rules_user_enabled").on(t.userAddress, t.enabled),
  ],
);

/** Alert history — triggered alert records */
export const alertHistory = pgTable(
  "alert_history",
  {
    id: serial("id").primaryKey(),
    ruleId: integer("rule_id")
      .notNull()
      .references(() => alertRules.id, { onDelete: "cascade" }),
    triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
    payloadJson: jsonb("payload_json"), // alert details (severity, account, metric, etc.)
    deliveryStatus: varchar("delivery_status", { length: 20 }).notNull().default("pending"), // pending, delivered, failed
    deliveryChannel: varchar("delivery_channel", { length: 20 }).notNull().default("in_app"), // in_app, webhook
    readAt: timestamp("read_at", { withTimezone: true }),
    retryCount: integer("retry_count").notNull().default(0),
  },
  (t) => [
    index("idx_alert_history_rule_time").on(t.ruleId, t.triggeredAt),
    index("idx_alert_history_status").on(t.deliveryStatus),
  ],
);
