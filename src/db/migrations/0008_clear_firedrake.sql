CREATE TABLE "auth_sessions" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"address" varchar(35) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"snapshot_time" timestamp with time zone NOT NULL,
	"address" varchar(35) NOT NULL,
	"xrp_balance" numeric(30, 10),
	"xrp_price_usd" numeric(20, 8),
	"token_value_usd" numeric(20, 8),
	"nft_count" integer,
	"amm_value_usd" numeric(20, 8),
	"locked_xrp" numeric(30, 10),
	"total_value_usd" numeric(20, 8),
	"token_breakdown" jsonb,
	CONSTRAINT "portfolio_snapshots_snapshot_time_address_pk" PRIMARY KEY("snapshot_time","address")
);
--> statement-breakpoint
CREATE TABLE "tracked_accounts" (
	"address" varchar(35) PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_snapshot" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_address" ON "auth_sessions" USING btree ("address");--> statement-breakpoint
CREATE INDEX "idx_auth_sessions_expires" ON "auth_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_portfolio_snap_addr_time" ON "portfolio_snapshots" USING btree ("address","snapshot_time");