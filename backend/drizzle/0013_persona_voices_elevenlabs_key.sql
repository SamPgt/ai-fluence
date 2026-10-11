ALTER TABLE "personas" ADD COLUMN "voices" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "elevenlabs_api_key_enc" text;--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN "elevenlabs_api_key_hint" text;