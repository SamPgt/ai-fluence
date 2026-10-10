CREATE TABLE "persona_places" (
	"persona_id" uuid NOT NULL,
	"place_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "places" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"identity" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"avatar_asset_id" uuid,
	"default_image_family" text,
	"master_thread_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "place_id" uuid;--> statement-breakpoint
ALTER TABLE "character_drafts" ADD COLUMN "kind" text DEFAULT 'character' NOT NULL;--> statement-breakpoint
ALTER TABLE "character_drafts" ADD COLUMN "place_id" uuid;--> statement-breakpoint
ALTER TABLE "persona_places" ADD CONSTRAINT "persona_places_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_places" ADD CONSTRAINT "persona_places_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "persona_places_idx" ON "persona_places" USING btree ("persona_id","place_id");--> statement-breakpoint
CREATE INDEX "places_user_idx" ON "places" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_drafts" ADD CONSTRAINT "character_drafts_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;