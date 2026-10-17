CREATE TABLE "voice_samples" (
	"voice_id" text PRIMARY KEY NOT NULL,
	"file_path" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "voice_id" text;