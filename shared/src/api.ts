/**
 * Contrats Request/Response entre le backend Hono et le frontend.
 * Les montants sont des chaînes décimales USD (comme SpicyAPI).
 */
import type { InputSchema, VideoRefMode } from './input';
import type { MediaKind, ModelBadge, TaskKind } from './models';

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
  available: boolean;
  tasks: Partial<Record<TaskKind, CatalogTask>>;
}

export interface CatalogResponse {
  families: CatalogFamily[];
  textModels: string[];
}

// ── Médias ────────────────────────────────────────────────────

export interface Asset {
  id: string;
  kind: 'upload' | 'output';
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
  /** Mots déclencheurs de cette LoRA (aucun, un ou plusieurs). */
  triggerWords: string[];
  /** Aperçu affiché dans la liste (LoRA importée depuis la bibliothèque). */
  previewUrl?: string;
  /** Page d'origine de la LoRA (Civitai). */
  sourceUrl?: string;
}

// ── Bibliothèque communautaire (Civitai) ─────────────────────

export type CivitaiSort = 'Most Downloaded' | 'Highest Rated' | 'Newest';

export interface CivitaiFile {
  /** Lien de téléchargement Civitai, résolu côté serveur à chaque génération. */
  url: string;
  fileName: string;
  sizeKB: number;
  /** Wan 2.2 : passe visée par ce fichier. */
  noise?: 'high' | 'low';
}

export interface CivitaiPreview {
  /** Image fixe (première image d'une vidéo). */
  url: string;
  /** Vidéo légère, lue au survol. */
  videoUrl?: string;
  nsfw: boolean;
}

export interface CivitaiLora {
  modelId: number;
  versionId: number;
  name: string;
  versionName: string;
  creator: string;
  pageUrl: string;
  /** Famille AI Fluence correspondante. */
  family: string;
  baseModel: string;
  triggerWords: string[];
  previews: CivitaiPreview[];
  files: CivitaiFile[];
  downloads: number;
  likes: number;
  nsfw: boolean;
}

export interface CivitaiSearchResponse {
  items: CivitaiLora[];
  nextCursor: string | null;
}

/** Taille maximale du texte d'un bloc de contexte. */
export const CONTEXT_BLOCK_MAX = 600;

/** Bloc du contexte du persona : envoyé à chaque génération de ce persona. */
export interface PersonaContextBlock {
  id: string;
  title: string;
  text: string;
}

export interface Persona {
  id: string;
  name: string;
  color: string;
  avatarAssetId: string | null;
  avatarUrl: string | null;
  contextBlocks: PersonaContextBlock[];
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

/** LoRA appliquée à une génération (instantané). */
export interface GenerationLora {
  id: string;
  label: string;
  triggerWords: string[];
}

/** Limite SpicyAPI : LoRA par génération. */
export const MAX_LORAS_PER_GENERATION = 3;

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
  /** Contextes utilisés (instantané au moment de la génération). */
  contexts: GenerationContext[];
  /** LoRA du persona cochées à l'envoi. */
  loras: GenerationLora[];
  lorasApplied: number;
  status: GenerationStatus;
  errorCode: string | null;
  errorMessage: string | null;
  estimatedCost: string | null;
  cost: string | null;
  settled: boolean;
  seed: number | null;
  outputs: Asset[];
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
  /** Contextes activés : leur texte est ajouté à la fin du prompt (« Additional details: … »). */
  contextIds?: string[];
  /** LoRA du persona cochées (aucune si absent, 3 max). */
  loraIds?: string[];
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
  /** Persona propriétaire, ou `null` pour un raccourci disponible partout. */
  personaId: string | null;
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
