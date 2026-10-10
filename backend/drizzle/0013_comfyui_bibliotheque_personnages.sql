CREATE TABLE "character_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text DEFAULT 'character' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"gender" text DEFAULT 'female' NOT NULL,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"preview_prompt" text NOT NULL,
	"family" text,
	"thread_id" uuid NOT NULL,
	"persona_id" uuid,
	"place_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"parent_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"zone" text DEFAULT 'character' NOT NULL,
	"phrase" text DEFAULT '' NOT NULL,
	"gendered" boolean DEFAULT false NOT NULL,
	"thumbnail_template" text DEFAULT '' NOT NULL,
	"thumbnail_family" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"fragment" text NOT NULL,
	"label" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"gender" text,
	"weight" real DEFAULT 1 NOT NULL,
	"favorite" boolean DEFAULT false NOT NULL,
	"hidden" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_thumbnails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"option_id" uuid NOT NULL,
	"gender" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"asset_id" uuid,
	"comfy_prompt_id" text,
	"generation_id" uuid,
	"family" text,
	"prompt" text DEFAULT '' NOT NULL,
	"error" text,
	"duration_ms" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE "scenes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"traits" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"place_id" uuid,
	"prompt" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "place_id" uuid;--> statement-breakpoint
ALTER TABLE "assets" ADD COLUMN "is_master" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "face_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "traits" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "variation" jsonb;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "provider" text DEFAULT 'spicy' NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "comfy_prompt_id" text;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "duration_ms" integer;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "identity" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "master_thread_id" uuid;--> statement-breakpoint
ALTER TABLE "threads" ADD COLUMN "hidden" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "character_drafts" ADD CONSTRAINT "character_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_drafts" ADD CONSTRAINT "character_drafts_thread_id_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."threads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_drafts" ADD CONSTRAINT "character_drafts_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "character_drafts" ADD CONSTRAINT "character_drafts_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_categories" ADD CONSTRAINT "library_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_categories" ADD CONSTRAINT "library_categories_parent_id_library_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."library_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_options" ADD CONSTRAINT "library_options_category_id_library_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."library_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_thumbnails" ADD CONSTRAINT "library_thumbnails_option_id_library_options_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."library_options"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_thumbnails" ADD CONSTRAINT "library_thumbnails_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_places" ADD CONSTRAINT "persona_places_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_places" ADD CONSTRAINT "persona_places_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "places" ADD CONSTRAINT "places_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scenes" ADD CONSTRAINT "scenes_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "character_drafts_user_idx" ON "character_drafts" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "library_categories_user_key_idx" ON "library_categories" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "library_options_category_idx" ON "library_options" USING btree ("category_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "library_options_category_fragment_idx" ON "library_options" USING btree ("category_id","fragment");--> statement-breakpoint
CREATE UNIQUE INDEX "library_thumbnails_option_gender_idx" ON "library_thumbnails" USING btree ("option_id","gender");--> statement-breakpoint
CREATE INDEX "library_thumbnails_status_idx" ON "library_thumbnails" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "persona_places_idx" ON "persona_places" USING btree ("persona_id","place_id");--> statement-breakpoint
CREATE INDEX "places_user_idx" ON "places" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "scenes_user_idx" ON "scenes" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_place_id_places_id_fk" FOREIGN KEY ("place_id") REFERENCES "public"."places"("id") ON DELETE set null ON UPDATE no action;