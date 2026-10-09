CREATE TABLE "library_thumbnails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"option_id" uuid NOT NULL,
	"gender" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"asset_id" uuid,
	"comfy_prompt_id" text,
	"prompt" text DEFAULT '' NOT NULL,
	"error" text,
	"duration_ms" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "library_thumbnails" ADD CONSTRAINT "library_thumbnails_option_id_library_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."library_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_thumbnails" ADD CONSTRAINT "library_thumbnails_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "library_thumbnails_option_gender_idx" ON "library_thumbnails" USING btree ("option_id","gender");--> statement-breakpoint
CREATE INDEX "library_thumbnails_status_idx" ON "library_thumbnails" USING btree ("status");