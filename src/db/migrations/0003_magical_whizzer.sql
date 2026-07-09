CREATE INDEX "idx_nft_vol_daily_marketplace" ON "nft_volume_daily" USING btree ("marketplace");--> statement-breakpoint
CREATE INDEX "idx_token_meta_issuer" ON "token_metadata" USING btree ("issuer");