/**
 * Contrats Request/Response entre le backend Hono et le frontend.
 * Les montants sont des chaînes décimales USD (comme SpicyAPI).
 */
import type { InputSchema, VideoRefMode } from './input';
import type { MediaKind, ModelBadge, ProviderId, TaskKind } from './models';
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

/** Dictée en direct : ElevenLabs Scribe v2 Realtime, Deepgram Flux ou Cartesia Ink-2. */
export type DictationProvider = 'elevenlabs' | 'deepgram' | 'cartesia';

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
  available: boolean;
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
  kind: PersonaKind;
  color: string;
  avatarAssetId: string | null;
  avatarUrl: string | null;
  contextBlocks: PersonaContextBlock[];
  loras: PersonaLora[];
  defaultImageFamily: string | null;
  defaultVideoFamily: string | null;
  voices: PersonaVoice[];
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
  outputs: Asset[];
  spicyTaskId: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Résultat supprimé du fil : la demande reste affichée, ses images non (outputs vides). */
  removedAt: string | null;
}

export interface GenerationRequest {
  threadId?: string | null;
  family: string;
  refMode?: VideoRefMode;
  prompt: string;
  params: Record<string, unknown>;
  referenceAssetIds: string[];
  /** Image à modifier (posée par « Éditer ») : la première image envoyée. Une consigne le précise au modèle. */
  editAssetId?: string;
  /** Contextes activés : leur texte est ajouté au prompt, dans la section « # Détails ». */
  contextIds?: string[];
  /** LoRA du persona cochées (aucune si absent, 3 max). */
  loraIds?: string[];
  /** Mots déclencheurs choisis pour chaque LoRA (id → mots). Seuls ceux-là vont dans le prompt. */
  loraWords?: Record<string, string[]>;
  /** Série : nombre d'images à générer avec cette demande (1 par défaut). Chacune a sa propre graine. */
  count?: number;
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
