import "server-only";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// Lazy singleton — safe to import this module even without DATABASE_URL.
// The actual connection is created on first query, not at import time.
// This allows the build to succeed and the app to start without a database;
// only DB-dependent routes will fail at runtime if DATABASE_URL is missing.
//
// Uses globalThis to survive Turbopack HMR reloads in development.
// Without this, each HMR re-evaluation creates a new connection pool
// while old pools leak, quickly exhausting Postgres max_connections.

const globalForDb = globalThis as unknown as {
  _pgClient?: ReturnType<typeof postgres>;
  _drizzleDb?: PostgresJsDatabase<typeof schema>;
};

function getClient(): ReturnType<typeof postgres> {
  if (!globalForDb._pgClient) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL environment variable is required");
    }
    // Append statement_timeout as a connection parameter so Postgres
    // kills any query running longer than 30s — prevents connection
    // starvation from runaway queries or lock contention.
    const connUrl = new URL(url);
    const existing = connUrl.searchParams.get("options") ?? "";
    connUrl.searchParams.set("options", (existing + " -c statement_timeout=30000").trim());
    globalForDb._pgClient = postgres(connUrl.toString(), {
      max: 25,
      idle_timeout: 30,
      connect_timeout: 10,
      max_lifetime: 3600, // recycle connections after 1 hour
    });
  }
  return globalForDb._pgClient;
}

function getDb(): PostgresJsDatabase<typeof schema> {
  if (!globalForDb._drizzleDb) {
    globalForDb._drizzleDb = drizzle(getClient(), { schema });
  }
  return globalForDb._drizzleDb;
}

// Export as getters so consumer code can use `db.select()...` etc.
// The Proxy forwards all property access to the lazily-initialized instance.
export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop, receiver) {
      const instance = getDb();
      const value = Reflect.get(instance, prop, receiver);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  },
);

export const client = new Proxy({} as ReturnType<typeof postgres>, {
  get(_target, prop, receiver) {
    const instance = getClient();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
  apply(_target, thisArg, args) {
    return Reflect.apply(getClient() as never, thisArg, args);
  },
});
