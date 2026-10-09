/**
 * Contrats Request/Response entre le backend Hono et le frontend.
 * Les montants sont des chaînes décimales USD (comme SpicyAPI).
 */
import type { InputSchema, VideoRefMode } from './input';
import type { MediaKind, ModelBadge, ModelProvider, TaskKind } from './models';
import type { LibraryZone } from './library';

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
  /** Prompt réellement envoyé (traits assemblés, texte libre, suffixe du persona, contextes). */
  finalPrompt: string;
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
