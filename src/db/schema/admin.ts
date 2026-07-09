import { pgTable, bigserial, serial, varchar, text, timestamp, index } from "drizzle-orm/pg-core";

/** Page view tracking for site analytics. Privacy-preserving: IP hashed with daily salt. */
export const pageViews = pgTable("page_views", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  route: varchar("route", { length: 200 }).notNull(),
  routePattern: varchar("route_pattern", { length: 100 }).notNull(),
  visitorHash: varchar("visitor_hash", { length: 64 }).notNull(),
  /** Hostname of the Referer header (e.g. "t.co", "x.com", "google.com").
   *  Null for direct visits and same-origin internal navigation. */
  referrerHost: varchar("referrer_host", { length: 100 }),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_page_views_pattern_time").on(t.routePattern, t.timestamp),
  index("idx_page_views_time").on(t.timestamp),
  index("idx_page_views_visitor_time").on(t.visitorHash, t.timestamp),
  index("idx_page_views_referrer_time").on(t.referrerHost, t.timestamp),
]);

/** API error log for monitoring. */
export const apiErrors = pgTable("api_errors", {
  id: serial("id").primaryKey(),
  route: varchar("route", { length: 200 }).notNull(),
  errorMessage: text("error_message").notNull(),
  stackTrace: text("stack_trace"),
  timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [
  index("idx_api_errors_time").on(t.timestamp),
]);
