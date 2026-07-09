CREATE TABLE "wallet_trade_volume_daily" (
	"day" date NOT NULL,
	"wallet" varchar(35) NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"buy_xrp_drops" bigint DEFAULT 0 NOT NULL,
	"sell_xrp_drops" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "wallet_trade_volume_daily_day_wallet_pk" PRIMARY KEY("day","wallet")
);
--> statement-breakpoint
CREATE TABLE "wallet_trade_volume_hourly" (
	"hour" timestamp with time zone NOT NULL,
	"wallet" varchar(35) NOT NULL,
	"trade_count" integer DEFAULT 0 NOT NULL,
	"buy_xrp_drops" bigint DEFAULT 0 NOT NULL,
	"sell_xrp_drops" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "wallet_trade_volume_hourly_hour_wallet_pk" PRIMARY KEY("hour","wallet")
);
--> statement-breakpoint
CREATE INDEX "idx_wallet_trade_vol_hour" ON "wallet_trade_volume_hourly" USING btree ("hour");