import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  GenerationContext,
  Gender,
  LibraryZone,
  ModelProvider,
  PersonaLora,
  TaskKind,
  ThumbnailGender,
  ThumbnailStatus,
} from '@ai-fluence/shared';

const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  /** Photo de profil (asset uploadé), affichée dans la bulle en bas à gauche. */
  avatarAssetId: uuid('avatar_asset_id'),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    userAgent: text('user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  t => [index('sessions_user_idx').on(t.userId)],
);

export const userSettings = pgTable('user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Clé SpicyAPI chiffrée (AES-256-GCM, cf. lib/crypto). */
  spicyApiKeyEnc: text('spicy_api_key_enc'),
  spicyApiKeyHint: text('spicy_api_key_hint'),
  /** Dossier des médias ; null = dossier par défaut sous DATA_DIR. */
  mediaDir: text('media_dir'),
  defaultImageFamily: text('default_image_family'),
  defaultVideoFamily: text('default_video_family'),
  // Modèle rapide (~5 s) : Grok 4.7 réfléchit longtemps (~30 s) pour une simple reformulation.
  enhanceModel: text('enhance_model').notNull().default('deepseek/v4.1-flash/chat'),
  updatedAt: updatedAt(),
});

export const personas = pgTable(
  'personas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').$type<'influencer' | 'art'>().notNull().default('influencer'),
    /** Genre du personnage : accorde le prompt et choisit les miniatures de la bibliothèque. */
    gender: text('gender').$type<Gender>(),
    color: text('color').notNull().default('#8b5cf6'),
    avatarAssetId: uuid('avatar_asset_id'),
    description: text('description').notNull().default(''),
    personality: text('personality').notNull().default(''),
    promptSuffix: text('prompt_suffix').notNull().default(''),
    triggerWord: text('trigger_word').notNull().default(''),
    loras: jsonb('loras').$type<PersonaLora[]>().notNull().default([]),
    defaultImageFamily: text('default_image_family'),
    defaultVideoFamily: text('default_video_family'),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index('personas_user_idx').on(t.userId)],
);

export const threads = pgTable(
  'threads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    personaId: uuid('persona_id').references(() => personas.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    isPinned: boolean('is_pinned').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index('threads_user_idx').on(t.userId, t.updatedAt)],
);

export const generations = pgTable(
  'generations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    personaId: uuid('persona_id').references(() => personas.id, { onDelete: 'set null' }),
    prompt: text('prompt').notNull(),
    finalPrompt: text('final_prompt').notNull(),
    family: text('family').notNull(),
    modelId: text('model_id').notNull(),
    task: text('task').$type<TaskKind>().notNull(),
    refMode: text('ref_mode').$type<'start-frame' | 'reference'>().notNull().default('start-frame'),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    /** `input` exact envoyé à SpicyAPI. */
    input: jsonb('input').$type<Record<string, unknown>>().notNull().default({}),
    referenceAssetIds: jsonb('reference_asset_ids').$type<string[]>().notNull().default([]),
    /** Image dont le visage est appliqué au résultat (ReActor, local). */
    faceAssetId: uuid('face_asset_id'),
    /** Série (demande ×N) : générations sœurs et position dans la série. */
    batchId: uuid('batch_id'),
    batchIndex: integer('batch_index').notNull().default(0),
    lorasApplied: integer('loras_applied').notNull().default(0),
    /** Contextes activés à l'envoi (instantané : reste lisible si le contexte est modifié ou supprimé). */
    contexts: jsonb('contexts').$type<GenerationContext[]>().notNull().default([]),
    status: text('status').$type<'queued' | 'running' | 'succeeded' | 'failed'>().notNull().default('queued'),
    spicyTaskId: text('spicy_task_id'),
    /** `spicy` (cloud) ou `comfy` (ComfyUI local). */
    provider: text('provider').$type<ModelProvider>().notNull().default('spicy'),
    /** `prompt_id` de la file ComfyUI (génération locale). */
    comfyPromptId: text('comfy_prompt_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    estimatedCost: text('estimated_cost'),
    cost: text('cost'),
    settled: boolean('settled').notNull().default(false),
    seed: integer('seed'),
    /** Durée de la génération (ComfyUI : exécution seule ; SpicyAPI : de la création à la fin de la tâche). */
    durationMs: integer('duration_ms'),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: createdAt(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  t => [
    index('generations_thread_idx').on(t.threadId, t.createdAt),
    index('generations_status_idx').on(t.status),
  ],
);

export const assets = pgTable(
  'assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    personaId: uuid('persona_id').references(() => personas.id, { onDelete: 'set null' }),
    generationId: uuid('generation_id').references(() => generations.id, { onDelete: 'set null' }),
    /** `thumbnail` : miniature d'une option de la bibliothèque (hors galerie). */
    kind: text('kind').$type<'upload' | 'output' | 'thumbnail'>().notNull(),
    mediaType: text('media_type').$type<'image' | 'video'>().notNull(),
    mime: text('mime').notNull(),
    /** Chemin absolu du fichier sur le disque. */
    filePath: text('file_path').notNull(),
    bytes: integer('bytes').notNull().default(0),
    width: integer('width'),
    height: integer('height'),
    durationSeconds: real('duration_seconds'),
    /** Fait partie de la bibliothèque de références du persona. */
    isReference: boolean('is_reference').notNull().default(false),
    /** Copie uploadée chez SpicyAPI (valable 24 h). */
    spicyUri: text('spicy_uri'),
    spicyUriExpiresAt: timestamp('spicy_uri_expires_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  t => [
    index('assets_user_idx').on(t.userId, t.createdAt),
    index('assets_generation_idx').on(t.generationId),
    index('assets_persona_idx').on(t.personaId),
  ],
);

export const promptPresets = pgTable(
  'prompt_presets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    text: text('text').notNull(),
    media: text('media').$type<'image' | 'video' | 'all'>().notNull().default('all'),
    /** Contexte masqué du composer sans être supprimé. */
    enabled: boolean('enabled').notNull().default(true),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [index('prompt_presets_user_idx').on(t.userId)],
);

// ── Bibliothèque (wildcards) ─────────────────────────────────

/** Une catégorie d'options (« Coupe de cheveux »), alimentée à la main ou par import de wildcards. */
export const libraryCategories = pgTable(
  'library_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Nom technique, unique par compte (`cheveux_coupe`, utilisable en `__cheveux_coupe__`). */
    key: text('key').notNull(),
    label: text('label').notNull(),
    description: text('description').notNull().default(''),
    /** Partie du prompt : Personnage, Tenue, Pose & action, Lieu & décor, Photo & ambiance. */
    zone: text('zone').$type<LibraryZone>().notNull().default('character'),
    /** Options montrées en version femme ou homme selon le personnage (coiffures, tenues…). */
    gendered: boolean('gendered').notNull().default(false),
    /** Prompt anglais des miniatures, `{option}` remplacé par le fragment. Vide = gabarit par défaut. */
    thumbnailTemplate: text('thumbnail_template').notNull().default(''),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex('library_categories_user_key_idx').on(t.userId, t.key)],
);

/** Une option : libellé français pour l'utilisateur, fragment anglais pour le modèle. */
export const libraryOptions = pgTable(
  'library_options',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => libraryCategories.id, { onDelete: 'cascade' }),
    /** Fragment de prompt anglais, en langage naturel (`a short bowl cut`). */
    fragment: text('fragment').notNull(),
    /** Libellé français ; null tant qu'il n'est pas traduit (le fragment est affiché avec un badge EN). */
    label: text('label'),
    tags: jsonb('tags').$type<string[]>().notNull().default([]),
    /** Option réservée à un genre (pack « coiffures femme ») ; null = pour les deux. */
    gender: text('gender').$type<Gender>(),
    /** Probabilité relative lors d'un tirage au hasard. */
    weight: real('weight').notNull().default(1),
    /** Fichier d'origine (import) ; vide pour une option ajoutée à la main. */
    source: text('source').notNull().default(''),
    position: integer('position').notNull().default(0),
    createdAt: createdAt(),
  },
  t => [
    index('library_options_category_idx').on(t.categoryId, t.position),
    uniqueIndex('library_options_category_fragment_idx').on(t.categoryId, t.fragment),
  ],
);

/** Miniature d'une option : une par version (femme, homme, ou `any` pour une catégorie sans genre). */
export const libraryThumbnails = pgTable(
  'library_thumbnails',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    optionId: uuid('option_id')
      .notNull()
      .references(() => libraryOptions.id, { onDelete: 'cascade' }),
    gender: text('gender').$type<ThumbnailGender>().notNull(),
    status: text('status').$type<ThumbnailStatus>().notNull().default('queued'),
    /** Image prête ; conservée pendant une régénération, remplacée quand la nouvelle est prête. */
    assetId: uuid('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    comfyPromptId: text('comfy_prompt_id'),
    /** Prompt envoyé (pour comprendre une miniature ratée). */
    prompt: text('prompt').notNull().default(''),
    error: text('error'),
    durationMs: integer('duration_ms'),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex('library_thumbnails_option_gender_idx').on(t.optionId, t.gender), index('library_thumbnails_status_idx').on(t.status)],
);
