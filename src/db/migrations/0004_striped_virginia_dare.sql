CREATE TABLE "recent_nft_trades" (
	"id" serial PRIMARY KEY NOT NULL,
	"tx_hash" varchar(64) NOT NULL,
	"nftoken_id" varchar(64) NOT NULL,
	"buyer" varchar(35) NOT NULL,
	"seller" varchar(35) NOT NULL,
	"amount_drops" bigint,
	"date" integer,
	"ledger_index" integer
);
