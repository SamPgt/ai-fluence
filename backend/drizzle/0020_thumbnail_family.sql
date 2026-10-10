ALTER TABLE "library_categories" ADD COLUMN "thumbnail_family" text;--> statement-breakpoint
ALTER TABLE "library_thumbnails" ADD COLUMN "generation_id" uuid;--> statement-breakpoint
ALTER TABLE "library_thumbnails" ADD COLUMN "family" text;