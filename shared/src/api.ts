/**
 * Contrats Request/Response entre le backend Hono et le frontend.
 * Les montants sont des chaînes décimales USD (comme SpicyAPI).
 */
import type { InputSchema, VideoRefMode } from './input';
import type { MediaKind, ModelBadge, ModelProvider, TaskKind } from './models';
import type { LibraryZone } from './library';
import type { CreatorKind, GenerationVariation, MasterAxis } from './masters';

// ── Auth ──────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  createdAt: string;
}

export interface AuthResponse {
  user: User;
}

export interface SignupRequest {
  email: string;
  name: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

// ── Paramètres ────────────────────────────────────────────────

export interface Settings {
  hasApiKey: boolean;
  /** Ex. `sk-spicy-••••1a2b`. Jamais la clé en clair. */
  apiKeyHint: string | null;
  mediaDir: string;
  defaultMediaDir: string;
  defaultImageFamily: string | null;
  defaultVideoFamily: string | null;
  enhanceModel: string;
}

export interface UpdateSettingsRequest {
  mediaDir?: string | null;
  defaultImageFamily?: string | null;
  defaultVideoFamily?: string | null;
  enhanceModel?: string;
}

export interface SetApiKeyRequest {
  apiKey: string;
}

export interface Balance {
  available: string;
  held: string;
  total: string;
}

export interface CreditsResponse {
  balance: Balance | null;
  /** Total dépensé via l'app (somme des coûts des générations). */
  spentInApp: string;
  generationCount: number;
  usage: { from: string; to: string; totalSpend: string; tasks: number } | null;
}

// ── ComfyUI (local) ───────────────────────────────────────────

export type ComfyState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

export interface ComfyStatus {
  /** `COMFYUI_URL` renseigné côté backend. Sinon, rien à afficher. */
  enabled: boolean;
  /** Commandes de démarrage/arrêt configurées : l'app peut piloter ComfyUI. */
  canControl: boolean;
  state: ComfyState;
  url: string | null;
  version: string | null;
  gpu: { name: string; vramTotal: number; vramFree: number } | null;
  error: string | null;
  /** Dernières lignes de sortie de la commande lancée (pour diagnostiquer). */
  log: string[];
}

// ── Catalogue ─────────────────────────────────────────────────

export interface CatalogTask {
  modelId: string;
  schema: InputSchema;
  startingPrice: { price: string; unit: string; variant: string } | null;
  policyTier: string | null;
}

export interface CatalogFamily {
  id: string;
  label: string;
  media: MediaKind;
  badges: ModelBadge[];
  hint: string;
  provider: ModelProvider;
  /** Accepte une image « visage » appliquée au résultat (ReActor, modèles locaux). */
  supportsFace: boolean;
  available: boolean;
  /** Pourquoi le modèle n'est pas utilisable (clé manquante, ComfyUI arrêté…). */
  unavailableReason: string | null;
  tasks: Partial<Record<TaskKind, CatalogTask>>;
}

export interface CatalogResponse {
  families: CatalogFamily[];
  textModels: string[];
}

// ── Médias ────────────────────────────────────────────────────

export interface Asset {
  id: string;
  kind: 'upload' | 'output' | 'thumbnail';
  mediaType: MediaKind;
  mime: string;
  /** URL servie par le backend (via le proxy `/api`). */
  url: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  personaId: string | null;
  isReference: boolean;
  /** Image master du persona (fait aussi partie de ses références). */
  isMaster: boolean;
  generationId: string | null;
  createdAt: string;
}

// ── Personas ──────────────────────────────────────────────────

export interface PersonaLora {
  id: string;
  label: string;
  /** Lien direct public vers le `.safetensors`. */
  path: string;
  scale: number;
  /** Famille de modèle pour laquelle la LoRA a été entraînée. */
  family: string;
  noise?: 'high' | 'low' | 'both';
}

export type Gender = 'female' | 'male';

export interface Persona {
  id: string;
  name: string;
  kind: 'influencer' | 'art';
  /** Genre du personnage (null : non précisé). */
  gender: Gender | null;
  /** Fiche d'identité (traits de la zone Personnage), ajoutée en bulles dans le composer. */
  identity: GenerationTrait[];
  color: string;
  avatarAssetId: string | null;
  avatarUrl: string | null;
  description: string;
  /** Personnalité, façon de parler, comportement : utilisé par l'amélioration de prompt. */
  personality: string;
  /** Ajouté à chaque prompt (DA, apparence…). */
  promptSuffix: string;
  triggerWord: string;
  loras: PersonaLora[];
  defaultImageFamily: string | null;
  defaultVideoFamily: string | null;
  referenceCount: number;
  createdAt: string;
  updatedAt: string;
}

export type PersonaInput = Omit<
  Persona,
  'id' | 'avatarUrl' | 'referenceCount' | 'createdAt' | 'updatedAt'
>;

// ── Fils et générations ───────────────────────────────────────

export interface Thread {
  id: string;
  title: string;
  personaId: string | null;
  isPinned: boolean;
  totalCost: string;
  generationCount: number;
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Contexte tel qu'il a été utilisé par une génération. */
export interface GenerationContext {
  id: string;
  label: string;
  text: string;
}

/** Trait choisi dans la bibliothèque (bulle du composer), figé avec la génération. */
export interface GenerationTrait {
  optionId: string;
  categoryId: string;
  categoryLabel: string;
  zone: LibraryZone;
  /** Libellé français ; null si non traduit. */
  label: string | null;
  fragment: string;
  /** Miniature de l'option (version du genre du personnage). */
  thumbnailUrl: string | null;
  /** Tiré au hasard (bulle 🎲 du composer) plutôt que choisi. */
  random?: boolean;
}

/**
 * Bulle 🎲 du composer : une catégorie tirée au hasard pour chaque image, dans toute la liste,
 * les favoris, ou une sélection (`pool`).
 */
export interface TraitSlot {
  categoryId: string;
  categoryLabel: string;
  zone: LibraryZone;
  drawFrom: 'all' | 'favorites' | 'pool';
  pool: string[];
}

export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface Generation {
  id: string;
  threadId: string;
  personaId: string | null;
  prompt: string;
  /** Prompt réellement envoyé (avec mot déclencheur et suffixe persona). */
  finalPrompt: string;
  family: string;
  modelId: string;
  task: TaskKind;
  params: Record<string, unknown>;
  refMode: VideoRefMode;
  references: Asset[];
  /** Image « visage » appliquée au résultat (ReActor). */
  face: Asset | null;
  traits: GenerationTrait[];
  /** Images master : axe et variante de cette image. */
  variation: GenerationVariation | null;
  /** Série : les générations d'une même demande ×N partagent ce `batchId`. */
  batchId: string | null;
  batchIndex: number;
  /** Contextes utilisés (instantané au moment de la génération). */
  contexts: GenerationContext[];
  lorasApplied: number;
  status: GenerationStatus;
  errorCode: string | null;
  errorMessage: string | null;
  estimatedCost: string | null;
  cost: string | null;
  settled: boolean;
  seed: number | null;
  /** Durée de la génération, en millisecondes. */
  durationMs: number | null;
  outputs: Asset[];
  provider: ModelProvider;
  spicyTaskId: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface GenerationRequest {
  threadId?: string | null;
  personaId?: string | null;
  family: string;
  refMode?: VideoRefMode;
  prompt: string;
  params: Record<string, unknown>;
  referenceAssetIds: string[];
  /** Image dont le visage est appliqué au résultat (modèles avec `supportsFace`). */
  faceAssetId?: string | null;
  /** Série : nombre d'images à générer avec cette demande (1 par défaut). Chacune a sa propre graine. */
  count?: number;
  /** Traits choisis dans la bibliothèque (ids d'options), assemblés en phrase avant le texte libre. */
  traitIds?: string[];
  /** Série : traits propres à chaque image (créateur de personnage, un tirage par variante). Prioritaire sur `traitIds`. */
  traitDraws?: string[][];
  /** Catégories tirées au hasard pour chaque image (bulles 🎲). */
  traitSlots?: Pick<TraitSlot, 'categoryId' | 'drawFrom' | 'pool'>[];
  /** Lieu récurrent : sa fiche est ajoutée aux traits. */
  placeId?: string | null;
  /** Genre du sujet quand il n'y a pas de persona (créateur de personnage) : accorde la phrase des traits. */
  gender?: Gender | null;
  /** Contextes activés : leur texte est ajouté à la fin du prompt (« Additional details: … »). */
  contextIds?: string[];
  /** Coût affiché à l'utilisateur au moment du clic (confirmation). */
  expectedCost?: string;
}

export interface UpscaleRequest {
  assetId: string;
  /** Palier de sortie (ex. `4k` pour une image, `1080p` pour une vidéo). */
  resolution?: string;
  expectedCost?: string;
}

export interface QuoteResponse {
  task: TaskKind;
  modelId: string;
  estimatedCost: string;
  maxCharge: string;
  quantity: string;
  unit: string;
  expiresAt: string;
  dropped: number;
  lorasApplied: number;
  /** Nombre d'images de la série ; `estimatedCost` et `maxCharge` sont des totaux. */
  count: number;
  /** Prompt réellement envoyé (traits assemblés, texte libre, suffixe du persona, contextes). Avec des tirages : un exemple. */
  finalPrompt: string;
  /** Le prompt contient des tirages (🎲, `__…__`, `{a|b}`) : `finalPrompt` n'est qu'un exemple. */
  randomized: boolean;
  /** Wildcards `__…__` inconnues, laissées telles quelles. */
  unknownWildcards: string[];
}

export interface CreateGenerationResponse {
  generation: Generation;
  thread: Thread;
}

/** 409 renvoyé quand le prix a augmenté depuis l'affichage. */
export interface PriceChangedResponse {
  error: 'price_changed';
  quote: QuoteResponse;
}

export interface ThreadDetailResponse {
  thread: Thread;
  generations: Generation[];
}

export interface SearchResult {
  threadId: string;
  threadTitle: string;
  matchedPrompt: string | null;
}

// ── Contextes (textes ajoutés à la fin du prompt) ─────────────

/** Contexte : texte ajouté à la fin du prompt quand il est activé dans le composer. */
export interface PromptPreset {
  id: string;
  label: string;
  text: string;
  media: MediaKind | 'all';
  /** Affiché dans le composer. */
  enabled: boolean;
  position: number;
}

export interface EnhancePromptRequest {
  prompt: string;
  personaId?: string | null;
  media: MediaKind;
}

export interface EnhancePromptResponse {
  prompt: string;
}

export interface ApiError {
  error: string;
  code?: string;
}

// ── Bibliothèque (wildcards) ──────────────────────────────────

export interface LibraryCategory {
  id: string;
  /** Nom technique (`cheveux_coupe`). */
  key: string;
  label: string;
  /** Catégorie parente (sous-catégorie) ; deux niveaux au plus. */
  parentId: string | null;
  description: string;
  /** Partie du prompt à laquelle appartient la catégorie (Personnage, Lieu & décor…). */
  zone: LibraryZone;
  /** Tournure dans le prompt : `{option} hairstyle` ; vide = le fragment tel quel. */
  phrase: string;
  /** Miniatures en version femme et homme (zones Personnage, Tenue, Pose & action). */
  gendered: boolean;
  thumbnailTemplate: string;
  optionCount: number;
  createdAt: string;
}

export interface LibraryOption {
  id: string;
  categoryId: string;
  /** Fragment anglais envoyé au modèle. */
  fragment: string;
  /** Libellé français ; null si non traduit. */
  label: string | null;
  /** Réservée à un genre ; null = pour les deux. */
  gender: Gender | null;
  tags: string[];
  weight: number;
  source: string;
  /** Favorite : filtre du sélecteur, tirage « parmi mes favoris ». */
  favorite: boolean;
  /** Masquée : hors du sélecteur et des tirages (récupérable). */
  hidden: boolean;
}

/** Version d'une miniature : femme, homme, ou unique (catégorie sans genre). */
export type ThumbnailGender = Gender | 'any';

export type ThumbnailStatus = 'queued' | 'running' | 'ready' | 'failed';

export interface LibraryThumbnail {
  optionId: string;
  gender: ThumbnailGender;
  status: ThumbnailStatus;
  /** Image prête (la précédente reste affichée pendant une régénération). */
  url: string | null;
  error: string | null;
  durationMs: number | null;
}

export interface LibraryImportResult {
  added: number;
  /** Lignes déjà présentes dans la catégorie. */
  duplicates: number;
  /** Lignes vides ou commentaires. */
  ignored: number;
}

// ── Créateur de personnage ────────────────────────────────────

/**
 * Un emplacement de la fiche d'identité = une catégorie de la zone Personnage.
 * `chosen` : une option fixée ; `random` : tirée pour chaque variante (dans `pool`, ou toute la catégorie) ;
 * `empty` : le modèle décide. `locked` : épargné par « Tout aléatoire ».
 */
export interface CharacterSlot {
  categoryId: string;
  mode: 'chosen' | 'random' | 'empty';
  optionId: string | null;
  pool: string[];
  /** Tirage aléatoire : toute la liste, les favoris de la catégorie, ou la sélection `pool`. */
  drawFrom?: 'all' | 'favorites' | 'pool';
  locked: boolean;
}

export interface CharacterDraft {
  id: string;
  /** Personnage ou lieu : la fiche se construit avec la zone Personnage ou Lieu & décor. */
  kind: CreatorKind;
  name: string;
  gender: Gender;
  slots: CharacterSlot[];
  /** Prompt neutre des variantes (cadrage, fond, lumière), pour juger le personnage, pas la scène. */
  previewPrompt: string;
  family: string | null;
  /** Fil masqué qui contient les variantes (un lot = une série). */
  threadId: string;
  /** Persona créé par « Garder ce personnage ». */
  personaId: string | null;
  /** Lieu créé par « Garder ce lieu ». */
  placeId: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Images master ─────────────────────────────────────────────

export interface PersonaMaster {
  asset: Asset;
  /** Axe de la variation qui l'a produite (null : image de référence, upload…). */
  axis: MasterAxis | null;
  variantLabel: string | null;
}

export interface MastersResponse {
  /** Fil masqué des variations (null tant qu'aucun lot n'a été lancé). */
  threadId: string | null;
  masters: PersonaMaster[];
}

export interface VariationRequest {
  /** `mix` : une variante tirée dans tous les axes pour chaque image. */
  axis: MasterAxis | 'mix';
  count: number;
  family: string;
  /** Applique le visage de l'image de référence (ReActor, local). Personnage seulement. */
  face: boolean;
  /** Lieu : part de l'image de référence (image → image) à cette force (0,3 à 0,95) ; absent = texte seul. */
  strength?: number;
  /** Réglages du modèle (proportions…). */
  params?: Record<string, unknown>;
}

export interface LibraryMoveResult {
  moved: number;
  /** Options laissées en place : le même fragment existe déjà dans la catégorie de destination. */
  duplicates: number;
}

// ── Lieux ─────────────────────────────────────────────────────

/** Lieu récurrent (sa chambre, son café…) : fiche, image de référence, images master, personnages rattachés. */
export interface Place {
  id: string;
  name: string;
  /** Fiche du lieu (traits de la zone Lieu & décor). */
  identity: GenerationTrait[];
  avatarAssetId: string | null;
  avatarUrl: string | null;
  defaultImageFamily: string | null;
  personaIds: string[];
  masterCount: number;
  createdAt: string;
  updatedAt: string;
}

// ── Scènes ────────────────────────────────────────────────────

/** Combinaison réutilisable pour n'importe quel personnage : bulles choisies et 🎲, lieu, texte libre. */
export interface Scene {
  id: string;
  name: string;
  traits: GenerationTrait[];
  slots: TraitSlot[];
  placeId: string | null;
  prompt: string;
  createdAt: string;
}
