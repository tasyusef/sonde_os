CREATE TABLE "token_cost_basis" (
	"address" varchar(35) NOT NULL,
	"currency" varchar(40) NOT NULL,
	"issuer" varchar(35) NOT NULL,
	"total_qty_acquired" numeric(30, 10) DEFAULT '0' NOT NULL,
	"total_cost_drops" numeric(30, 0) DEFAULT '0' NOT NULL,
	"total_cost_usd" numeric(20, 8) DEFAULT '0' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_cost_basis_address_currency_issuer_pk" PRIMARY KEY("address","currency","issuer")
);
--> statement-breakpoint
CREATE INDEX "idx_cost_basis_address" ON "token_cost_basis" USING btree ("address");