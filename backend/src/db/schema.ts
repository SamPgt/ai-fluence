import {
  type AnyPgColumn,
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
  CharacterSlot,
  CreatorKind,
  GenerationContext,
  GenerationTrait,
  GenerationVariation,
  Gender,
  LibraryZone,
  ModelProvider,
  PersonaLora,
  TraitSlot,
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
    /** Fiche d'identité (créateur de personnage) : traits ajoutés en bulles dans le composer. */
    identity: jsonb('identity').$type<GenerationTrait[]>().notNull().default([]),
    /** Fil masqué des variations (images master). Sans clé étrangère : fils et personas se référencent déjà. */
    masterThreadId: uuid('master_thread_id'),
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
    /** Fil technique (variantes du créateur de personnage) : absent de la liste des fils et de la galerie. */
    hidden: boolean('hidden').notNull().default(false),
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
    /** Traits de la bibliothèque (instantané : reste lisible si l'option est modifiée ou supprimée). */
    traits: jsonb('traits').$type<GenerationTrait[]>().notNull().default([]),
    /** Images master : axe et variante de cette image. */
    variation: jsonb('variation').$type<GenerationVariation>(),
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
    /** Image d'un lieu récurrent (référence ou master). */
    placeId: uuid('place_id').references((): AnyPgColumn => places.id, { onDelete: 'set null' }),
    /** Image master du persona (validée pour la cohérence, puis le jeu d'entraînement d'une LoRA). */
    isMaster: boolean('is_master').notNull().default(false),
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
    /**
     * Catégorie parente (« Vêtements » › « Hauts ») : deux niveaux au plus, même zone que le parent.
     * Parent supprimé : ses sous-catégories remontent au premier niveau.
     */
    parentId: uuid('parent_id').references((): AnyPgColumn => libraryCategories.id, { onDelete: 'set null' }),
    description: text('description').notNull().default(''),
    /** Partie du prompt : Personnage, Tenue, Pose & action, Lieu & décor, Photo & ambiance. */
    zone: text('zone').$type<LibraryZone>().notNull().default('character'),
    /** Tournure de l'option dans le prompt (`{option} hairstyle`) ; vide = le fragment tel quel. */
    phrase: text('phrase').notNull().default(''),
    /** Options montrées en version femme ou homme selon le personnage (coiffures, tenues…). */
    gendered: boolean('gendered').notNull().default(false),
    /** Prompt anglais des miniatures, `{option}` remplacé par le fragment. Vide = gabarit par défaut. */
    thumbnailTemplate: text('thumbnail_template').notNull().default(''),
    /** Modèle des miniatures (famille, locale ou API). Null = Z-Image en local. */
    thumbnailFamily: text('thumbnail_family'),
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
    /** Favorite : filtre du sélecteur, tirage « parmi mes favoris ». */
    favorite: boolean('favorite').notNull().default(false),
    /** Masquée : hors du sélecteur et des tirages, sans être supprimée (récupérable). */
    hidden: boolean('hidden').notNull().default(false),
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
    /** Modèle API : la miniature passe par une génération (fil masqué), suivie ici. */
    generationId: uuid('generation_id'),
    /** Modèle qui a produit (ou produit) la miniature. */
    family: text('family'),
    /** Prompt envoyé (pour comprendre une miniature ratée). */
    prompt: text('prompt').notNull().default(''),
    error: text('error'),
    durationMs: integer('duration_ms'),
    updatedAt: updatedAt(),
  },
  t => [uniqueIndex('library_thumbnails_option_gender_idx').on(t.optionId, t.gender), index('library_thumbnails_status_idx').on(t.status)],
);

/** Création de personnage en cours : fiche d'identité et fil masqué de ses variantes. */
export const characterDrafts = pgTable(
  'character_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Personnage ou lieu. */
    kind: text('kind').$type<CreatorKind>().notNull().default('character'),
    name: text('name').notNull().default(''),
    gender: text('gender').$type<Gender>().notNull().default('female'),
    slots: jsonb('slots').$type<CharacterSlot[]>().notNull().default([]),
    previewPrompt: text('preview_prompt').notNull(),
    family: text('family'),
    threadId: uuid('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    personaId: uuid('persona_id').references(() => personas.id, { onDelete: 'set null' }),
    placeId: uuid('place_id').references((): AnyPgColumn => places.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index('character_drafts_user_idx').on(t.userId, t.updatedAt)],
);

/** Lieu récurrent (sa chambre de gameuse, son café…) : fiche, image de référence, images master. */
export const places = pgTable(
  'places',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Fiche du lieu : traits de la zone Lieu & décor. */
    identity: jsonb('identity').$type<GenerationTrait[]>().notNull().default([]),
    /** Image de référence (première master), base des variations en image → image. */
    avatarAssetId: uuid('avatar_asset_id'),
    defaultImageFamily: text('default_image_family'),
    /** Fil masqué des variations (images master). */
    masterThreadId: uuid('master_thread_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index('places_user_idx').on(t.userId, t.createdAt)],
);

/** Lieux rattachés à un personnage (un même lieu peut servir à plusieurs). */
export const personaPlaces = pgTable(
  'persona_places',
  {
    personaId: uuid('persona_id')
      .notNull()
      .references(() => personas.id, { onDelete: 'cascade' }),
    placeId: uuid('place_id')
      .notNull()
      .references(() => places.id, { onDelete: 'cascade' }),
  },
  t => [uniqueIndex('persona_places_idx').on(t.personaId, t.placeId)],
);

/** Scène enregistrée : bulles choisies et 🎲, lieu, texte libre ; réutilisable pour n'importe quel personnage. */
export const scenes = pgTable(
  'scenes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    traits: jsonb('traits').$type<GenerationTrait[]>().notNull().default([]),
    slots: jsonb('slots').$type<TraitSlot[]>().notNull().default([]),
    placeId: uuid('place_id').references(() => places.id, { onDelete: 'set null' }),
    prompt: text('prompt').notNull().default(''),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  t => [index('scenes_user_idx').on(t.userId, t.createdAt)],
);
