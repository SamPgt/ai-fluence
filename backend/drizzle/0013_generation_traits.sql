ALTER TABLE "generations" ADD COLUMN "traits" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "library_categories" ADD COLUMN "phrase" text DEFAULT '' NOT NULL;