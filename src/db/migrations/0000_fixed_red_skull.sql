CREATE TABLE "amendment_votes" (
	"amendment_hash" varchar(64) NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"yes_count" integer DEFAULT 0 NOT NULL,
	"threshold" integer DEFAULT 0 NOT NULL,
	"total_validators" integer DEFAULT 0 NOT NULL,
	"has_majority" boolean DEFAULT false NOT NULL,
	CONSTRAINT "amendment_votes_amendment_hash_recorded_at_pk" PRIMARY KEY("amendment_hash","recorded_at")
);
--> statement-breakpoint
CREATE TABLE "amendments" (
	"hash" varchar(64) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"enabled_at" timestamp with time zone,
	"first_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "amm_pools" (
	"account" varchar(35) PRIMARY KEY NOT NULL,
	"asset1_currency" varchar(40) NOT NULL,
	"asset1_issuer" varchar(35),
	"asset2_currency" varchar(40) NOT NULL,
	"asset2_issuer" varchar(35),
	"created_at" timestamp with time zone DEFAULT NOW() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingested_ledgers" (
	"ledger_index" integer PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_state" (
	"key" varchar(50) PRIMARY KEY NOT NULL,
	"value" varchar(500) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketplace_registry" (
	"address" varchar(35) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"domain" varchar(200),
	"added_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nft_volume_daily" (
	"day" date NOT NULL,
	"issuer" varchar(35) NOT NULL,
	"marketplace" varchar(100) DEFAULT '' NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"xrp_volume_drops" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "nft_volume_daily_day_issuer_marketplace_pk" PRIMARY KEY("day","issuer","marketplace")
);
--> statement-breakpoint
CREATE TABLE "nft_volume_hourly" (
	"hour" timestamp with time zone NOT NULL,
	"issuer" varchar(35) NOT NULL,
	"marketplace" varchar(100) DEFAULT '' NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"xrp_volume_drops" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "nft_volume_hourly_hour_issuer_marketplace_pk" PRIMARY KEY("hour","issuer","marketplace")
);
--> statement-breakpoint
CREATE TABLE "token_metadata" (
	"currency" varchar(40) NOT NULL,
	"issuer" varchar(35) DEFAULT '' NOT NULL,
	"name" varchar(100),
	"icon" text,
	"issuer_name" varchar(100),
	"holders" integer,
	"trustlines" integer,
	"updated_at" timestamp with time zone DEFAULT NOW() NOT NULL,
	CONSTRAINT "token_metadata_currency_issuer_pk" PRIMARY KEY("currency","issuer")
);
--> statement-breakpoint
CREATE TABLE "token_volume_daily" (
	"day" date NOT NULL,
	"currency" varchar(40) NOT NULL,
	"issuer" varchar(35) DEFAULT '' NOT NULL,
	"pair_currency" varchar(40) NOT NULL,
	"pair_issuer" varchar(35) DEFAULT '' NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"volume" numeric(30, 10) DEFAULT '0' NOT NULL,
	"xrp_volume_drops" bigint DEFAULT 0,
	CONSTRAINT "token_volume_daily_day_currency_issuer_pair_currency_pair_issuer_pk" PRIMARY KEY("day","currency","issuer","pair_currency","pair_issuer")
);
--> statement-breakpoint
CREATE TABLE "token_volume_hourly" (
	"hour" timestamp with time zone NOT NULL,
	"currency" varchar(40) NOT NULL,
	"issuer" varchar(35) DEFAULT '' NOT NULL,
	"pair_currency" varchar(40) NOT NULL,
	"pair_issuer" varchar(35) DEFAULT '' NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"volume" numeric(30, 10) DEFAULT '0' NOT NULL,
	"xrp_volume_drops" bigint DEFAULT 0,
	CONSTRAINT "token_volume_hourly_hour_currency_issuer_pair_currency_pair_issuer_pk" PRIMARY KEY("hour","currency","issuer","pair_currency","pair_issuer")
);
--> statement-breakpoint
CREATE INDEX "idx_amendment_votes_time" ON "amendment_votes" USING btree ("recorded_at");--> statement-breakpoint
CREATE INDEX "idx_amendment_votes_hash" ON "amendment_votes" USING btree ("amendment_hash");--> statement-breakpoint
CREATE INDEX "idx_nft_vol_daily_day" ON "nft_volume_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "idx_nft_vol_hour" ON "nft_volume_hourly" USING btree ("hour");--> statement-breakpoint
CREATE INDEX "idx_nft_vol_issuer" ON "nft_volume_hourly" USING btree ("issuer");--> statement-breakpoint
CREATE INDEX "idx_nft_vol_marketplace" ON "nft_volume_hourly" USING btree ("marketplace");--> statement-breakpoint
CREATE INDEX "idx_token_meta_holders" ON "token_metadata" USING btree ("holders");--> statement-breakpoint
CREATE INDEX "idx_token_vol_daily_day" ON "token_volume_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "idx_token_vol_daily_currency" ON "token_volume_daily" USING btree ("currency","issuer");--> statement-breakpoint
CREATE INDEX "idx_token_vol_hour" ON "token_volume_hourly" USING btree ("hour");--> statement-breakpoint
CREATE INDEX "idx_token_vol_currency" ON "token_volume_hourly" USING btree ("currency","issuer");