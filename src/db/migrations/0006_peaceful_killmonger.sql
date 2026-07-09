ALTER TABLE "token_volume_daily" ADD COLUMN "open_price" numeric(30, 15);--> statement-breakpoint
ALTER TABLE "token_volume_daily" ADD COLUMN "high_price" numeric(30, 15);--> statement-breakpoint
ALTER TABLE "token_volume_daily" ADD COLUMN "low_price" numeric(30, 15);--> statement-breakpoint
ALTER TABLE "token_volume_daily" ADD COLUMN "close_price" numeric(30, 15);--> statement-breakpoint
ALTER TABLE "token_volume_hourly" ADD COLUMN "open_price" numeric(30, 15);--> statement-breakpoint
ALTER TABLE "token_volume_hourly" ADD COLUMN "high_price" numeric(30, 15);--> statement-breakpoint
ALTER TABLE "token_volume_hourly" ADD COLUMN "low_price" numeric(30, 15);--> statement-breakpoint
ALTER TABLE "token_volume_hourly" ADD COLUMN "close_price" numeric(30, 15);