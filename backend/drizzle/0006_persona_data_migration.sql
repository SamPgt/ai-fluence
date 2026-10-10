-- Copie des anciens champs texte du persona dans des blocs de contexte.
UPDATE "personas" p SET "context_blocks" = COALESCE((
  SELECT jsonb_agg(b.block ORDER BY b.ord) FROM (
    SELECT 1 AS ord, jsonb_build_object('id', gen_random_uuid()::text, 'title', 'Description', 'text', p."description", 'mode', 'rewrite') AS block WHERE btrim(p."description") <> ''
    UNION ALL
    SELECT 2, jsonb_build_object('id', gen_random_uuid()::text, 'title', 'Personnalité', 'text', p."personality", 'mode', 'rewrite') WHERE btrim(p."personality") <> ''
    UNION ALL
    SELECT 3, jsonb_build_object('id', gen_random_uuid()::text, 'title', 'Apparence et DA', 'text', p."prompt_suffix", 'mode', 'prompt') WHERE btrim(p."prompt_suffix") <> ''
  ) b
), '[]'::jsonb);
--> statement-breakpoint
-- Le mot déclencheur passe dans chaque LoRA (liste triggerWords).
UPDATE "personas" p SET "loras" = COALESCE((
  SELECT jsonb_agg(l || jsonb_build_object('triggerWords',
    CASE WHEN btrim(p."trigger_word") <> '' THEN jsonb_build_array(btrim(p."trigger_word")) ELSE '[]'::jsonb END))
  FROM jsonb_array_elements(p."loras") l
), '[]'::jsonb)
WHERE jsonb_array_length(p."loras") > 0;
