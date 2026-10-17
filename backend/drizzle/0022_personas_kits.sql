ALTER TABLE "user_settings" ADD COLUMN "default_image_family" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "default_video_family" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "loras" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- Un fil n'appartient plus à un persona, et les raccourcis sont tous généraux.
UPDATE "threads" SET "persona_id" = NULL;--> statement-breakpoint
UPDATE "prompt_presets" SET "persona_id" = NULL;
