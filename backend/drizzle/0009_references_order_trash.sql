ALTER TABLE "assets" ADD COLUMN "reference_position" integer;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "deleted_at" timestamp with time zone;