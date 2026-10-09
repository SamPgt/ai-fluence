ALTER TABLE "library_options" ADD COLUMN "favorite" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "library_options" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;