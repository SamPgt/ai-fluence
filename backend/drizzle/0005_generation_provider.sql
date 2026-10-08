ALTER TABLE "generations" ADD COLUMN "provider" text DEFAULT 'spicy' NOT NULL;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "comfy_prompt_id" text;