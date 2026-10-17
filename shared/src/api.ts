/**
 * Contrats Request/Response entre le backend Hono et le frontend.
 * Les montants sont des chaînes décimales USD (comme SpicyAPI).
 */
import type { InputSchema, VideoRefMode } from './input';
import type { MediaKind, ModelBadge, ModelProvider, ProviderId, TaskKind } from './models';
import type { LibraryZone } from './library';
import type { CreatorKind, GenerationVariation, MasterAxis, ReferencePoses } from './masters';
import type { WorkflowGraph, WorkflowInputValue } from './workflow';

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
  hasElevenLabsKey: boolean;
  /** Ex. `sk_••••1a2b`. Jamais la clé en clair. */
  elevenLabsKeyHint: string | null;
  enhanceModel: string;
  /** Modèles proposés par défaut dans le composer (null : celui de l'app). */
  defaultImageFamily: string | null;
  defaultVideoFamily: string | null;
  /** LoRA de Général (rangés dans aucun persona). */
  loras: PersonaLora[];
  /** Fournisseur de la dictée du composer. */
  dictationProvider: DictationProvider;
  /** Fournisseurs de dictée utilisables (clé configurée sur le serveur ; ElevenLabs : clé du compte). */
  dictationProviders: DictationProvider[];
}

/** Dictée en direct : ElevenLabs Scribe v2 Realtime, Deepgram Flux, Cartesia Ink-2, ou Whisper en local (serveur de voix). */
export type DictationProvider = 'elevenlabs' | 'deepgram' | 'cartesia' | 'whisper';

/** Modèles de dictée, rangés comme le menu des modèles : Rapide, Précis, Autre. */
export const DICTATION_MODELS: {
  id: DictationProvider;
  label: string;
  brand: string;
  logo: string;
  hint: string;
  section: 'fast' | 'accurate' | 'other';
}[] = [
  {
    id: 'deepgram',
    label: 'Deepgram Flux',
    brand: 'Deepgram',
    logo: '/providers/deepgram.svg',
    hint: 'Le texte arrive quasi instantanément',
    section: 'fast',
  },
  {
    id: 'cartesia',
    label: 'Cartesia Ink-2',
    brand: 'Cartesia',
    logo: '/providers/cartesia.svg',
    hint: 'Très précis, par petits morceaux',
    section: 'accurate',
  },
  {
    id: 'elevenlabs',
    label: 'ElevenLabs Scribe v2 Realtime',
    brand: 'ElevenLabs',
    logo: '/providers/elevenlabs.svg',
    hint: 'Très précis, texte provisoire en direct',
    section: 'accurate',
  },
  {
    id: 'whisper',
    label: 'Whisper large-v3-turbo (local)',
    brand: 'OpenAI · sur ton GPU',
    logo: '/providers/openai.svg',
    hint: 'Gratuit et privé, texte mis à jour chaque seconde',
    section: 'other',
  },
];

/** Jeton de dictée : le navigateur se connecte directement au fournisseur avec lui. */
export interface DictationTokenResponse {
  provider: DictationProvider;
  token: string;
  /** Tests : dictée simulée, sans micro ni réseau. */
  fake: boolean;
}

export interface UpdateSettingsRequest {
  mediaDir?: string | null;
  enhanceModel?: string;
  defaultImageFamily?: string | null;
  defaultVideoFamily?: string | null;
  loras?: PersonaLora[];
  dictationProvider?: DictationProvider;
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
  /** Nœud JoyCaption installé (ComfyUI en marche) : « Décrire » une image en prompt. */
  canDescribe: boolean;
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
  provider: ProviderId;
  recommended?: number;
  lowCost?: boolean;
  /** Où tourne la génération : SpicyAPI (`spicy`) ou le ComfyUI local (`comfy`). */
  runtime: ModelProvider;
  /** Accepte une image « visage » appliquée au résultat (ReActor, modèles locaux). */
  supportsFace: boolean;
  available: boolean;
  /** Pourquoi le modèle n'est pas utilisable (clé manquante, ComfyUI arrêté…). */
  unavailableReason: string | null;
  tasks: Partial<Record<TaskKind, CatalogTask>>;
  /** Durée typique d'une génération (médiane de tes générations réussies), en secondes. */
  typicalSeconds: number | null;
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
  /** Mots déclencheurs de cette LoRA (aucun, un ou plusieurs). */
  triggerWords: string[];
  /** Mots décochés dans la fiche : jamais proposés dans le composer. */
  hiddenWords?: string[];
  /** Aperçu affiché dans la liste (LoRA importée depuis la bibliothèque). */
  previewUrl?: string;
  /** Page d'origine de la LoRA (Civitai). */
  sourceUrl?: string;
  /**
   * LoRA Civitai disponible pour plusieurs modèles : un fichier (une ligne) par
   * modèle coché, toutes reliées par `key`. `available` liste les modèles possibles.
   */
  group?: PersonaLoraGroup;
}

export interface PersonaLoraGroup {
  key: string;
  available: {
    family: string;
    files: { url: string; noise?: 'high' | 'low' }[];
    triggerWords: string[];
  }[];
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

/** Fichier(s) d'une LoRA Civitai pour un de nos modèles. */
export interface CivitaiVariant {
  family: string;
  baseModel: string;
  versionId: number;
  versionName: string;
  triggerWords: string[];
  files: CivitaiFile[];
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
  /** Une entrée par modèle compatible (la première = champs ci-dessus). */
  variants: CivitaiVariant[];
}

export interface CivitaiSearchResponse {
  items: CivitaiLora[];
  nextCursor: string | null;
}

/** Pack de wildcards Civitai (une archive de listes). */
export interface CivitaiWildcard {
  /** Version téléchargée (la plus récente). */
  versionId: number;
  modelId: number;
  name: string;
  creator: string | null;
  downloads: number;
  sizeKB: number;
}

export interface CivitaiWildcardSearchResponse {
  items: CivitaiWildcard[];
  nextCursor: string | null;
}

/** Une liste d'un pack de wildcards : `total` éléments, dont `items` gardés (2000 au plus). */
export interface WildcardList {
  name: string;
  total: number;
  items: string[];
  /** `tags` : écrite pour Stable Diffusion (suites de tags) ; une reformulation est proposée. */
  format: 'tags' | 'text';
}

/** Reformulation d'éléments de liste en phrases (modèle de texte, payant). */
export interface ListRewriteQuoteResponse {
  count: number;
  estimatedCost: string;
}

export interface ListRewriteResponse {
  items: string[];
  cost: string | null;
}

export interface CivitaiWildcardListsResponse {
  lists: WildcardList[];
}

// ── Librairies de photos libres de droits (Unsplash, Pexels) ──

export type LibrarySource = 'unsplash' | 'pexels';

export interface LibraryPhoto {
  id: string;
  description: string;
  width: number;
  height: number;
  /** Couleur dominante, affichée pendant le chargement de l'image. */
  color: string;
  /** Image servie par le CDN de la source (affichage direct). */
  thumbUrl: string;
  /** Page de la photo sur la source (attribution). */
  pageUrl: string;
  /** Photographe : nom, pseudo (affiché « @pseudo », null si inconnu) et profil. */
  author: { name: string; username: string | null; profileUrl: string };
}

export interface LibrarySearchResponse {
  items: LibraryPhoto[];
  /** Page suivante, ou null en fin de liste. */
  nextPage: number | null;
}

/** Sources configurées (clé présente dans backend/.env). */
export type LibraryStatus = Record<LibrarySource, boolean>;

/** Taille maximale du texte d'un bloc de contexte. */
/** Longueur maximale saisie dans un bloc de contexte. */
export const CONTEXT_BLOCK_MAX = 500;
/** Accepté par le serveur : marge au-delà de la saisie, pour les blocs plus longs déjà enregistrés. */
export const CONTEXT_BLOCK_STORED_MAX = 600;

/** Bloc du contexte du persona : envoyé à chaque génération de ce persona. */
export interface PersonaContextBlock {
  id: string;
  title: string;
  text: string;
}

export type Gender = 'female' | 'male';
/** Voix ElevenLabs choisie pour un persona (catalogue ElevenLabs). */
export interface PersonaVoice {
  id: string;
  /** Identifiant ElevenLabs de la voix. */
  voiceId: string;
  publicOwnerId?: string;
  name: string;
  /** Extrait audio public (lecture dans l'interface). */
  previewUrl: string | null;
  /** Caractéristiques affichées : genre, âge, accent, usage… */
  labels: Record<string, string>;
  description?: string;
}

/** Voix du catalogue ElevenLabs (liste de sélection). */
export interface VoiceLibraryItem {
  voiceId: string;
  /** Bibliothèque communautaire : propriétaire public (pour ajouter la voix au compte avant usage). */
  publicOwnerId?: string;
  /** default : voix proposée par ElevenLabs ; library : voix partagée par la communauté. */
  source: 'default' | 'library';
  name: string;
  previewUrl: string | null;
  labels: Record<string, string>;
  description?: string;
  category?: string;
}

export interface VoiceLibraryResponse {
  voices: VoiceLibraryItem[];
  hasMore: boolean;
}

/** Type de persona : il adapte la fiche (pas de voix pour un persona artistique). */
export type PersonaKind = 'influencer' | 'artistic';

export interface Persona {
  id: string;
  name: string;
  /** Genre du personnage (null : non précisé). */
  gender: Gender | null;
  /** Fiche d'identité (traits de la zone Personnage), ajoutée en bulles dans le composer. */
  identity: GenerationTrait[];
  kind: PersonaKind;
  color: string;
  avatarAssetId: string | null;
  avatarUrl: string | null;
  contextBlocks: PersonaContextBlock[];
  loras: PersonaLora[];
  defaultImageFamily: string | null;
  defaultVideoFamily: string | null;
  /** Planche de références : l'image retenue pour chaque pose (face, trois-quarts, profil). */
  referencePoses: ReferencePoses;
  voices: PersonaVoice[];
  referenceCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Voix d'un personnage (vidéos parlées, outil local) : un extrait de référence que le serveur de voix imite.
 * « Créer une voix » génère une courte vidéo LTX dont on garde la voix, proposée avant d'être adoptée.
 */
export interface PersonaLocalVoice {
  /** Serveur de voix et ComfyUI configurés (sinon la carte est masquée). */
  enabled: boolean;
  /** Extrait de référence adopté (null : pas encore de voix). */
  url: string | null;
  durationSeconds: number | null;
  /** Expressivité par défaut (0,25 calme → 1 très expressive). */
  exaggeration: number;
  /** Voix proposée par la dernière création, en attente d'être gardée ou écartée. */
  candidate: { audioUrl: string; videoUrl: string | null } | null;
  /** Création en cours ou échouée. */
  job: { state: 'running' | 'failed'; startedAt: string; error: string | null } | null;
}

export type PersonaInput = Omit<
  Persona,
  'id' | 'avatarUrl' | 'referencePoses' | 'referenceCount' | 'createdAt' | 'updatedAt'
>;

// ── Fils et générations ───────────────────────────────────────

export interface Thread {
  id: string;
  title: string;
  /** Personas dont une référence a servi dans le fil (bulles à droite du titre). */
  personaIds: string[];
  isPinned: boolean;
  totalCost: string;
  generationCount: number;
  coverUrl: string | null;
  /** Les 3 dernières images du fil, de la plus récente à la plus ancienne (cartes de l'Accueil). */
  previewUrls: string[];
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
/** LoRA appliquée à une génération (instantané). */
export interface GenerationLora {
  id: string;
  label: string;
  /** Mots déclencheurs réellement envoyés. */
  triggerWords: string[];
}

/** Limite SpicyAPI : LoRA par génération. */
export const MAX_LORAS_PER_GENERATION = 3;

export type GenerationStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface Generation {
  id: string;
  /** Fil de la génération ; null pour un résultat de workflow. */
  threadId: string | null;
  workflowId: string | null;
  workflowNodeId: string | null;
  /** Voix du persona envoyée comme référence (id dans le persona). */
  voiceId: string | null;
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
  /** Durée de la génération, en millisecondes. */
  durationMs: number | null;
  outputs: Asset[];
  /** Où elle a tourné : SpicyAPI (`spicy`) ou le ComfyUI local (`comfy`). */
  runtime: ModelProvider;
  spicyTaskId: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Résultat supprimé du fil : la demande reste affichée, ses images non (outputs vides). */
  removedAt: string | null;
}

export interface GenerationRequest {
  threadId?: string | null;
  /** Personnage choisi dans le composer (facultatif) : son genre, sa voix (« Texte dit »), sa planche. Le fil, lui, n'appartient à aucun persona. */
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
  /** Image à modifier (posée par « Éditer ») : la première image envoyée. Une consigne le précise au modèle. */
  editAssetId?: string;
  /** Contextes activés : leur texte est ajouté au prompt, dans la section « # Détails ». */
  contextIds?: string[];
  /** LoRA du persona cochées (aucune si absent, 3 max). */
  loraIds?: string[];
  /** Mots déclencheurs choisis pour chaque LoRA (id → mots). Seuls ceux-là vont dans le prompt. */
  loraWords?: Record<string, string[]>;
  /** Coût affiché à l'utilisateur au moment du clic (confirmation). */
  expectedCost?: string;
  /** Voix du persona (id dans le persona) envoyée comme référence aux modèles vidéo qui l'acceptent. */
  voiceId?: string;
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
  /** Workflows lancés depuis ce fil (formulaire au-dessus du composer). */
  workflowRuns: ThreadWorkflowRun[];
}

export interface SearchResult {
  threadId: string;
  threadTitle: string;
  matchedPrompt: string | null;
  /** Demande dont le prompt correspond : on arrive dessus dans le fil (null si seul le titre correspond). */
  matchedGenerationId: string | null;
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
  /** Modèle des miniatures (famille) ; null = Z-Image en local. */
  thumbnailFamily: string | null;
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
  /** Modèle qui a produit la miniature. */
  family: string | null;
}

/** Devis des miniatures à générer avec un modèle API (gratuit en local). */
export interface ThumbnailQuote {
  family: string;
  runtime: ModelProvider;
  count: number;
  /** Coût estimé d'une miniature, puis du total. */
  unitCost: string;
  totalCost: string;
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
  /** Modèle à références (klein, Qwen Edit…) : l'image de référence est donnée au modèle comme « image 1 ». */
  reference?: boolean;
  /** Variantes imposées de l'axe, une par image (planche de références) ; `count` est alors ignoré. */
  variants?: string[];
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

// ── Corbeille ─────────────────────────────────────────────────

export interface TrashedPersona {
  id: string;
  name: string;
  color: string;
  avatarUrl: string | null;
  /** Références parties à la corbeille avec ce persona. */
  referenceCount: number;
  deletedAt: string;
  /** Date de suppression définitive. */
  purgeAt: string;
}

export interface TrashedThread {
  id: string;
  title: string;
  coverUrl: string | null;
  deletedAt: string;
  purgeAt: string;
}

export interface TrashedWorkflow {
  id: string;
  name: string;
  nodeCount: number;
  deletedAt: string;
  purgeAt: string;
}

export interface TrashResponse {
  /** Durée de conservation, en jours. */
  days: number;
  personas: TrashedPersona[];
  threads: TrashedThread[];
  workflows: TrashedWorkflow[];
}

// ── Workflows ─────────────────────────────────────────────────

export interface WorkflowSummary {
  id: string;
  name: string;
  nodeCount: number;
  /** Entrées « À fournir » : utilisable depuis un fil quand il y en a et que toutes ont un libellé. */
  inputCount: number;
  usableInThread: boolean;
  /** Couverture choisie (null : aucune, la liste montre alors la dernière image produite). */
  coverAssetId: string | null;
  /** Image affichée en couverture : celle choisie, sinon la dernière produite par le workflow. */
  coverUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Workflow extends WorkflowSummary {
  graph: WorkflowGraph;
}

export interface UpdateWorkflowRequest {
  name?: string;
  graph?: WorkflowGraph;
  /** Couverture : un média du compte, ou null pour revenir à la dernière image produite. */
  coverAssetId?: string | null;
}

/** `stopped` : arrêtée par l'utilisateur (les étapes en attente ne sont pas parties). */
export type WorkflowRunStatus = 'running' | 'succeeded' | 'failed' | 'stopped';
export type WorkflowNodeStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';

export interface WorkflowRun {
  id: string;
  status: WorkflowRunStatus;
  nodeIds: string[];
  estimatedCost: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** Un élément d'un lot, tel qu'enregistré (colonne `items`). */
export interface WorkflowStoredItem {
  /** Élément de la liste de départ (« robe rouge »). */
  label: string;
  status: WorkflowNodeStatus;
  generationId?: string | null;
  text?: string | null;
  cost?: string | null;
  errorMessage?: string | null;
}

/** Un élément d'un lot, avec sa génération. */
export interface WorkflowResultItem {
  label: string;
  status: WorkflowNodeStatus;
  generation: Generation | null;
  text: string | null;
  cost: string | null;
  errorMessage: string | null;
}

/**
 * Résultat d'un nœud lors d'une exécution : un lot. Une image (ou un texte), ou, pour un
 * nœud qui a reçu une liste, un élément par passe (`items`).
 */
export interface WorkflowNodeResult {
  id: string;
  runId: string;
  nodeId: string;
  status: WorkflowNodeStatus;
  /** Génération (nœuds image et vidéo), avec ses médias. */
  generation: Generation | null;
  /** Texte produit (nœuds de texte). */
  text: string | null;
  /** Lot d'une liste : un élément par passe, dans l'ordre de la liste. Null hors liste. */
  items: WorkflowResultItem[] | null;
  cost: string | null;
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** État d'exécution d'un workflow : la dernière exécution et l'historique des résultats par nœud. */
export interface WorkflowStateResponse {
  run: WorkflowRun | null;
  /** Du plus récent au plus ancien. */
  results: WorkflowNodeResult[];
}

export interface WorkflowRunRequest {
  /** Graphe tel qu'affiché (éditeur) : enregistré avant le lancement. Absent : le workflow enregistré. */
  graph?: WorkflowGraph;
  /** Nœuds à lancer (absent : tous les nœuds payants). */
  nodeIds?: string[];
  /** Devis confirmé par l'utilisateur. */
  expectedCost?: string;
  /** Valeurs des entrées « À fournir » (depuis un fil). */
  inputs?: Record<string, WorkflowInputValue>;
  /** Lancement depuis un fil : ce fil, ou null pour en créer un. */
  thread?: { id: string | null };
}

export interface WorkflowRunStartResponse extends WorkflowStateResponse {
  /** Fil où s'affiche l'exécution (créé au besoin). */
  threadId: string | null;
}

/** Valeur saisie au lancement depuis un fil, telle qu'affichée dans la bulle. */
export interface WorkflowRunInput {
  nodeId: string;
  label: string;
  text?: string;
  assetIds?: string[];
}

/** Exécution lancée depuis un fil, affichée à sa place dans la conversation. */
export interface ThreadWorkflowRun {
  id: string;
  workflowId: string;
  workflowName: string;
  coverUrl: string | null;
  status: WorkflowRunStatus;
  inputs: (WorkflowRunInput & { assets: Asset[] })[];
  /** Résultat final : médias des nœuds finaux de cette exécution. */
  outputs: Asset[];
  /** Résultat supprimé du fil (réversible) : il est masqué partout. */
  removed: boolean;
  cost: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface WorkflowQuoteResponse {
  estimatedCost: string;
  /** Tâche de chaque étape : génération (`text-to-image`…) ou modèle de texte (`text`). */
  nodes: {
    nodeId: string;
    task: TaskKind | 'text';
    /** Prix de l'étape : celui d'une passe × `count`. */
    estimatedCost: string;
    /** Nombre de passes : une par élément de la liste reçue, sinon 1. */
    count: number;
  }[];
}

/**
 * Modèles locaux, réglés par fichier de ComfyUI (dossiers `diffusion_models` et `unet`) : `family` impose son type
 * (sinon il est déduit du nom), `hidden` le retire des choix. Une famille dont tous les fichiers sont cachés
 * disparaît des modèles proposés.
 */
export type LocalModelsConfig = Record<string, { family?: string; hidden?: boolean }>;

/** Un fichier de modèle de ComfyUI, vu par Paramètres → Modèles locaux. */
export interface LocalModelFile {
  file: string;
  /** Taille en octets (si le dossier de ComfyUI est connu). */
  bytes: number | null;
  /** Famille déduite du nom du fichier (null : non reconnu). */
  detected: string | null;
  /** Famille retenue : imposée, sinon déduite. */
  family: string | null;
  /** Type imposé à la main (sinon déduit du nom). */
  assigned: boolean;
  hidden: boolean;
}

export interface LocalModelsResponse {
  files: LocalModelFile[];
  /** Familles locales auxquelles on peut rattacher un fichier. */
  families: { id: string; label: string; assignable: boolean }[];
}

// ── Aide à l'écriture (local : dictée Whisper, reformulation Ollama) ──

export interface AssistStatus {
  /** Dictée possible (serveur de voix configuré). */
  dictation: boolean;
  /** Reformulation possible (Ollama répond, avec un modèle). */
  rewrite: boolean;
  /** Modèle Ollama utilisé. */
  model: string | null;
}

export interface RewritePromptRequest {
  text: string;
  media: MediaKind;
  /** Famille de modèle visée (`local/ltx-2.3`…) : ses règles d'écriture. */
  familyId?: string | null;
  modelLabel?: string | null;
  /** Images jointes (image de départ d'une vidéo, références d'une retouche). */
  attachments: number;
  gender?: string | null;
}

export interface RewritePromptResponse {
  /** Prompt envoyé au modèle. */
  en: string;
  /** Le même, en français, pour le relire. */
  fr: string;
  model: string;
}
