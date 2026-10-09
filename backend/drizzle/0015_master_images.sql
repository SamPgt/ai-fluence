ALTER TABLE "assets" ADD COLUMN "is_master" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "variation" jsonb;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "master_thread_id" uuid;--> statement-breakpoint
-- Image de référence d'un persona issu du créateur : sa première master.
UPDATE "assets" SET "is_master" = true WHERE "generation_id" IS NOT NULL AND "id" IN (SELECT "avatar_asset_id" FROM "personas" WHERE "avatar_asset_id" IS NOT NULL);
