CREATE TABLE "fee_burn_daily" (
	"day" date NOT NULL,
	"tx_count" integer DEFAULT 0 NOT NULL,
	"total_burn_drops" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "fee_burn_daily_day_pk" PRIMARY KEY("day")
);
--> statement-breakpoint
CREATE TABLE "fee_burn_hourly" (
	"hour" timestamp with time zone NOT NULL,
	"tx_count" integer DEFAULT 0 NOT NULL,
	"total_burn_drops" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "fee_burn_hourly_hour_pk" PRIMARY KEY("hour")
);
--> statement-breakpoint
CREATE TABLE "payment_corridor_daily" (
	"day" date NOT NULL,
	"src_currency" varchar(40) NOT NULL,
	"src_issuer" varchar(35) DEFAULT '' NOT NULL,
	"dst_currency" varchar(40) NOT NULL,
	"dst_issuer" varchar(35) DEFAULT '' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"xrp_volume_drops" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_corridor_daily_day_src_currency_src_issuer_dst_currency_dst_issuer_pk" PRIMARY KEY("day","src_currency","src_issuer","dst_currency","dst_issuer")
);
--> statement-breakpoint
CREATE TABLE "payment_corridor_hourly" (
	"hour" timestamp with time zone NOT NULL,
	"src_currency" varchar(40) NOT NULL,
	"src_issuer" varchar(35) DEFAULT '' NOT NULL,
	"dst_currency" varchar(40) NOT NULL,
	"dst_issuer" varchar(35) DEFAULT '' NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"xrp_volume_drops" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "payment_corridor_hourly_hour_src_currency_src_issuer_dst_currency_dst_issuer_pk" PRIMARY KEY("hour","src_currency","src_issuer","dst_currency","dst_issuer")
);
--> statement-breakpoint
CREATE TABLE "tx_count_daily" (
	"day" date NOT NULL,
	"tx_type" varchar(40) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tx_count_daily_day_tx_type_pk" PRIMARY KEY("day","tx_type")
);
--> statement-breakpoint
CREATE TABLE "tx_count_hourly" (
	"hour" timestamp with time zone NOT NULL,
	"tx_type" varchar(40) NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tx_count_hourly_hour_tx_type_pk" PRIMARY KEY("hour","tx_type")
);
--> statement-breakpoint
CREATE INDEX "idx_fee_burn_hour" ON "fee_burn_hourly" USING btree ("hour");--> statement-breakpoint
CREATE INDEX "idx_corridor_daily_day" ON "payment_corridor_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "idx_corridor_hour" ON "payment_corridor_hourly" USING btree ("hour");--> statement-breakpoint
CREATE INDEX "idx_tx_count_daily_day" ON "tx_count_daily" USING btree ("day");--> statement-breakpoint
CREATE INDEX "idx_tx_count_hour" ON "tx_count_hourly" USING btree ("hour");