CREATE TABLE "library_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"gendered" boolean DEFAULT false NOT NULL,
	"thumbnail_template" text DEFAULT '' NOT NULL,
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
	"weight" real DEFAULT 1 NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "personas" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "library_categories" ADD CONSTRAINT "library_categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_options" ADD CONSTRAINT "library_options_category_id_library_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."library_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "library_categories_user_key_idx" ON "library_categories" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "library_options_category_idx" ON "library_options" USING btree ("category_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "library_options_category_fragment_idx" ON "library_options" USING btree ("category_id","fragment");