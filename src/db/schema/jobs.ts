import { pgTable, varchar, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";

/** Background job state — persistent locks, scheduling, and job-specific state */
export const jobState = pgTable("job_state", {
  jobName: varchar("job_name", { length: 50 }).primaryKey(),
  status: varchar("status", { length: 20 }).notNull().default("idle"), // idle | running | failed
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  runCount: integer("run_count").notNull().default(0),
  lastError: text("last_error"),
  stateJson: jsonb("state_json"), // job-specific state (anomaly cooldowns, etc.)
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
