import {
  pgTable,
  varchar,
  bigint,
  text,
  integer,
  timestamp,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const nftMetadata = pgTable(
  "nft_metadata",
  {
    nftokenId: varchar("nftoken_id", { length: 64 }).primaryKey(),
    issuer: varchar("issuer", { length: 35 }).notNull(),
    taxon: bigint("taxon", { mode: "number" }).notNull(),
    uri: text("uri"),
    name: text("name"),
    /** Collection name extracted from the JSON metadata's `collection`
     *  field (string or `{name: ...}` object) or `collection_name`
     *  variant. When present, this is the canonical collection name —
     *  takes priority over consensus-from-individual-names which is
     *  unreliable for collections with unique-per-NFT titles (faker-style
     *  random names, etc.). Null when the metadata didn't carry it. */
    collectionName: text("collection_name"),
    imageUrl: text("image_url"),
    description: text("description"),
    attributes: jsonb("attributes"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    fetchStatus: varchar("fetch_status", { length: 16 })
      .notNull()
      .default("pending"),
    fetchAttempts: integer("fetch_attempts").notNull().default(0),
  },
  (t) => [
    index("idx_nft_metadata_issuer_taxon").on(t.issuer, t.taxon),
    index("idx_nft_metadata_fetch_status").on(t.fetchStatus, t.fetchedAt),
  ],
);

export const nftCollections = pgTable(
  "nft_collections",
  {
    issuer: varchar("issuer", { length: 35 }).notNull(),
    taxon: bigint("taxon", { mode: "number" }).notNull(),
    name: text("name"),
    imageUrl: text("image_url"),
    representativeNftokenId: varchar("representative_nftoken_id", { length: 64 }),
    /** Which resolver layer produced this name. One of: `"json"`,
     *  `"toml"`, `"consensus"`, or null when unresolved. Used by the
     *  collection-resolver cron to decide whether to re-try a row when
     *  a higher-priority source becomes available. */
    source: varchar("source", { length: 16 }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .default(sql`NOW()`),
    fetchStatus: varchar("fetch_status", { length: 16 })
      .notNull()
      .default("pending"),
  },
  (t) => [
    primaryKey({ columns: [t.issuer, t.taxon] }),
  ],
);
