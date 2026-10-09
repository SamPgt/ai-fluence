ALTER TABLE "generations" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "batch_index" integer DEFAULT 0 NOT NULL;