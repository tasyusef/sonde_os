CREATE TABLE "token_holder_snapshots" (
	"snapshot_time" timestamp with time zone NOT NULL,
	"currency" varchar(40) NOT NULL,
	"issuer" varchar(35) NOT NULL,
	"holder_address" varchar(35) NOT NULL,
	"balance" numeric(30, 10) NOT NULL,
	"total_supply" numeric(30, 10) NOT NULL,
	"rank" smallint NOT NULL,
	CONSTRAINT "token_holder_snapshots_snapshot_time_currency_issuer_holder_address_pk" PRIMARY KEY("snapshot_time","currency","issuer","holder_address")
);
--> statement-breakpoint
CREATE INDEX "idx_holder_snap_token_time" ON "token_holder_snapshots" USING btree ("currency","issuer","snapshot_time");