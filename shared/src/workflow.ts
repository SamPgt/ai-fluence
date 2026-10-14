/**
 * Workflows : nœuds typés reliés par des connecteurs typés (texte, image, vidéo).
 * Règles du graphe partagées : le front s'en sert pour refuser un lien pendant le glisser,
 * le serveur pour refuser un graphe invalide à l'enregistrement.
 */

/** Type d'un connecteur : un lien ne relie que deux connecteurs du même type. */
export type PortType = 'text' | 'image' | 'video';

export type WorkflowNodeType =
  | 'text'
  | 'image-source'
  | 'describe'
  | 'llm'
  | 'image-gen'
  | 'video-gen'
  | 'output';

export interface PortDef {
  id: string;
  type: PortType;
  label: string;
  /** Entrée qui accepte plusieurs liens (sinon un seul : un nouveau lien remplace l'ancien). */
  multiple?: boolean;
  /** Entrée nécessaire pour lancer le nœud. */
  required?: boolean;
}

export interface WorkflowNodeDef {
  type: WorkflowNodeType;
  label: string;
  /** Quelques mots sous le nom dans la palette (une seule ligne). */
  hint: string;
  inputs: PortDef[];
  outputs: PortDef[];
  /** Le lancer coûte de l'argent (appel SpicyAPI). */
  paid: boolean;
}

export const PORT_LABELS: Record<PortType, string> = {
  text: 'Texte',
  image: 'Image',
  video: 'Vidéo',
};

export const WORKFLOW_NODES: Record<WorkflowNodeType, WorkflowNodeDef> = {
  text: {
    type: 'text',
    label: 'Texte',
    hint: 'Prompt ou consigne écrite',
    inputs: [],
    outputs: [{ id: 'text', type: 'text', label: 'Texte' }],
    paid: false,
  },
  'image-source': {
    type: 'image-source',
    label: 'Image source',
    hint: 'Imports, assets ou banques d’images',
    inputs: [],
    outputs: [{ id: 'image', type: 'image', label: 'Images' }],
    paid: false,
  },
  describe: {
    type: 'describe',
    label: 'Décrire une image',
    hint: 'Décrit les images reçues',
    inputs: [{ id: 'images', type: 'image', label: 'Images', multiple: true, required: true }],
    outputs: [{ id: 'text', type: 'text', label: 'Description' }],
    paid: true,
  },
  llm: {
    type: 'llm',
    label: 'Texte IA',
    hint: 'Reformule, traduit, adapte',
    inputs: [
      { id: 'text', type: 'text', label: 'Texte', multiple: true, required: true },
      { id: 'images', type: 'image', label: 'Images', multiple: true },
    ],
    outputs: [{ id: 'text', type: 'text', label: 'Texte' }],
    paid: true,
  },
  'image-gen': {
    type: 'image-gen',
    label: 'Générer une image',
    hint: 'Texte ou images vers image',
    inputs: [
      { id: 'prompt', type: 'text', label: 'Prompt', required: true },
      { id: 'references', type: 'image', label: 'Références', multiple: true },
    ],
    outputs: [{ id: 'image', type: 'image', label: 'Image' }],
    paid: true,
  },
  'video-gen': {
    type: 'video-gen',
    label: 'Générer une vidéo',
    hint: 'Texte ou image vers vidéo',
    inputs: [
      { id: 'prompt', type: 'text', label: 'Prompt', required: true },
      { id: 'start', type: 'image', label: 'Image de début' },
      { id: 'end', type: 'image', label: 'Image de fin' },
      { id: 'references', type: 'image', label: 'Références', multiple: true },
    ],
    outputs: [{ id: 'video', type: 'video', label: 'Vidéo' }],
    paid: true,
  },
  output: {
    type: 'output',
    label: 'Résultat',
    hint: 'Images et vidéos finales',
    inputs: [
      { id: 'images', type: 'image', label: 'Images', multiple: true },
      { id: 'videos', type: 'video', label: 'Vidéos', multiple: true },
    ],
    outputs: [],
    paid: false,
  },
};

/** Modèle de texte par défaut des nœuds Décrire / Texte IA : lit les images, très économique. */
export const WORKFLOW_TEXT_MODEL_DEFAULT = 'anthropic/claude-haiku-5.5/chat';

/** Catégories de la palette des nœuds, dans l'ordre d'affichage. */
export const WORKFLOW_NODE_GROUPS: { label: string; types: WorkflowNodeType[] }[] = [
  { label: 'Entrées', types: ['text', 'image-source'] },
  { label: 'Texte IA', types: ['describe', 'llm'] },
  { label: 'Génération', types: ['image-gen', 'video-gen'] },
  { label: 'Sortie', types: ['output'] },
];

export const WORKFLOW_NODE_TYPES = Object.keys(WORKFLOW_NODES) as WorkflowNodeType[];

export const isWorkflowNodeType = (t: string): t is WorkflowNodeType => t in WORKFLOW_NODES;

// ── Graphe enregistré ─────────────────────────────────────────

export interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  position: { x: number; y: number };
  /** Réglages du nœud (texte, modèle, paramètres…), propres à chaque type. */
  data: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  /** Cadrage du canvas, retrouvé à l'ouverture. */
  viewport?: { x: number; y: number; zoom: number };
}

export const WORKFLOW_LIMITS = { nodes: 200, edges: 500, nameLength: 80 } as const;

export const emptyGraph = (): WorkflowGraph => ({ nodes: [], edges: [] });

export interface Connection {
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

const outputOf = (node: WorkflowNode | undefined, port: string) =>
  node ? WORKFLOW_NODES[node.type]?.outputs.find(p => p.id === port) : undefined;
const inputOf = (node: WorkflowNode | undefined, port: string) =>
  node ? WORKFLOW_NODES[node.type]?.inputs.find(p => p.id === port) : undefined;

/** `target` est-il atteignable depuis `from` en suivant les liens ? */
function reaches(edges: WorkflowEdge[], from: string, target: string): boolean {
  const next = new Map<string, string[]>();
  for (const e of edges) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

/**
 * Pourquoi ce lien est refusé (null : accepté). Une entrée simple déjà reliée n'est pas
 * un refus : le nouveau lien remplace l'ancien (cf. `connect`).
 */
export function connectionError(graph: WorkflowGraph, c: Connection): string | null {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const source = byId.get(c.source);
  const target = byId.get(c.target);
  if (!source || !target) return 'Nœud introuvable.';
  if (c.source === c.target) return 'Un nœud ne peut pas se relier à lui-même.';
  const out = outputOf(source, c.sourceHandle);
  const input = inputOf(target, c.targetHandle);
  if (!out || !input) return 'Connecteur introuvable.';
  if (out.type !== input.type) {
    return `Types incompatibles : ${PORT_LABELS[out.type].toLowerCase()} vers ${PORT_LABELS[input.type].toLowerCase()}.`;
  }
  if (
    graph.edges.some(
      e => e.source === c.source && e.sourceHandle === c.sourceHandle && e.target === c.target && e.targetHandle === c.targetHandle,
    )
  ) {
    return 'Ce lien existe déjà.';
  }
  if (reaches(graph.edges, c.target, c.source)) return 'Ce lien créerait une boucle.';
  return null;
}

/** Ajoute le lien (supposé valide) ; sur une entrée simple, il remplace l'ancien. */
export function connect(graph: WorkflowGraph, c: Connection, id: string): WorkflowGraph {
  const target = graph.nodes.find(n => n.id === c.target);
  const single = !inputOf(target, c.targetHandle)?.multiple;
  const edges = single
    ? graph.edges.filter(e => !(e.target === c.target && e.targetHandle === c.targetHandle))
    : graph.edges;
  return {
    ...graph,
    edges: [...edges, { id, source: c.source, sourceHandle: c.sourceHandle, target: c.target, targetHandle: c.targetHandle }],
  };
}

/** Ordre d'exécution : chaque nœud après ceux dont il dépend. Null s'il y a une boucle. */
export function topologicalOrder(graph: WorkflowGraph): string[] | null {
  const indegree = new Map(graph.nodes.map(n => [n.id, 0]));
  const next = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!indegree.has(e.source) || !indegree.has(e.target)) continue;
    indegree.set(e.target, indegree.get(e.target)! + 1);
    next.set(e.source, [...(next.get(e.source) ?? []), e.target]);
  }
  // Ordre stable : à égalité, l'ordre des nœuds dans le graphe.
  const queue = graph.nodes.filter(n => indegree.get(n.id) === 0).map(n => n.id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const t of next.get(id) ?? []) {
      indegree.set(t, indegree.get(t)! - 1);
      if (indegree.get(t) === 0) queue.push(t);
    }
  }
  return order.length === graph.nodes.length ? order : null;
}

/** Entrées obligatoires sans lien : le nœud ne peut pas encore être lancé. */
export function missingInputs(graph: WorkflowGraph, nodeId: string): PortDef[] {
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node) return [];
  return WORKFLOW_NODES[node.type].inputs.filter(
    p => p.required && !graph.edges.some(e => e.target === nodeId && e.targetHandle === p.id),
  );
}

/**
 * Erreurs de structure d'un graphe enregistré (vide : valide). Un nœud incomplet n'est pas
 * une erreur : un brouillon de workflow s'enregistre, seul son lancement est refusé.
 */
export function graphErrors(graph: WorkflowGraph): string[] {
  const errors: string[] = [];
  if (graph.nodes.length > WORKFLOW_LIMITS.nodes) errors.push(`${WORKFLOW_LIMITS.nodes} nœuds au maximum.`);
  if (graph.edges.length > WORKFLOW_LIMITS.edges) errors.push(`${WORKFLOW_LIMITS.edges} liens au maximum.`);
  const ids = new Set<string>();
  for (const n of graph.nodes) {
    if (ids.has(n.id)) errors.push(`Nœud en double : ${n.id}.`);
    ids.add(n.id);
    if (!isWorkflowNodeType(n.type)) errors.push(`Type de nœud inconnu : ${n.type}.`);
  }
  const edgeIds = new Set<string>();
  const seen: WorkflowEdge[] = [];
  for (const e of graph.edges) {
    if (edgeIds.has(e.id)) errors.push(`Lien en double : ${e.id}.`);
    edgeIds.add(e.id);
    const err = connectionError({ nodes: graph.nodes, edges: seen }, e);
    if (err) errors.push(`Lien ${e.id} : ${err}`);
    else {
      const target = graph.nodes.find(n => n.id === e.target);
      if (!inputOf(target, e.targetHandle)?.multiple && seen.some(s => s.target === e.target && s.targetHandle === e.targetHandle)) {
        errors.push(`Lien ${e.id} : cette entrée n’accepte qu’un seul lien.`);
      }
    }
    seen.push(e);
  }
  return errors;
}

// ── Exécution ─────────────────────────────────────────────────

/** Valeur portée par une sortie : du texte ou des images (ids de médias). */
export interface PortValue {
  text?: string;
  assetIds?: string[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export const isPaidNode = (node: WorkflowNode) => WORKFLOW_NODES[node.type]?.paid ?? false;

/** Sortie d'un nœud d'entrée (gratuit), lue dans ses réglages. Null pour un nœud payant. */
export function staticOutput(node: WorkflowNode, _port: string): PortValue | null {
  switch (node.type) {
    case 'text':
      return { text: str(node.data.text) };
    case 'image-source':
      return { assetIds: strings(node.data.assetIds) };
    default:
      return null;
  }
}

/** Liens arrivant sur une entrée, dans leur ordre (celui de la numérotation des références). */
export const edgesInto = (graph: WorkflowGraph, nodeId: string, port: string) =>
  graph.edges.filter(e => e.target === nodeId && e.targetHandle === port);

/** Nœuds payants reliés directement aux entrées de ce nœud (les nœuds d'entrée n'ont pas d'entrées). */
export function paidSources(graph: WorkflowGraph, nodeId: string): string[] {
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  return [
    ...new Set(graph.edges.filter(e => e.target === nodeId && byId.get(e.source) && isPaidNode(byId.get(e.source)!)).map(e => e.source)),
  ];
}

/** Nœuds payants à lancer, dans l'ordre de leurs dépendances (tous si `nodeIds` est absent). */
export function runOrder(graph: WorkflowGraph, nodeIds?: string[]): string[] {
  const order = topologicalOrder(graph) ?? [];
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const wanted = nodeIds ? new Set(nodeIds) : null;
  return order.filter(id => isPaidNode(byId.get(id)!) && (!wanted || wanted.has(id)));
}

/** Ce qu'il faut pour lancer un nœud de génération. */
export interface GenerationPlan {
  family: string;
  params: Record<string, unknown>;
  prompt: string;
  /** Images envoyées, dans l'ordre (l'image 1 est la première). */
  referenceAssetIds: string[];
  refMode: 'start-frame' | 'reference';
}

/**
 * Demande de génération d'un nœud Générer image / vidéo, à partir des valeurs reçues
 * sur ses entrées. `valueOf` donne la valeur d'une sortie (null : pas encore de résultat).
 */
export function generationPlan(
  graph: WorkflowGraph,
  nodeId: string,
  valueOf: (sourceId: string, port: string) => PortValue | null,
): { ok: true; plan: GenerationPlan } | { ok: false; reason: string } {
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node || (node.type !== 'image-gen' && node.type !== 'video-gen')) return { ok: false, reason: 'Nœud introuvable.' };
  const family = str(node.data.family);
  if (!family) return { ok: false, reason: 'Choisis un modèle.' };

  const values = (port: string) => edgesInto(graph, nodeId, port).map(e => valueOf(e.source, e.sourceHandle));
  const missing = (port: string) => values(port).some(v => v === null);
  for (const port of ['prompt', 'references', 'start', 'end']) {
    if (missing(port)) return { ok: false, reason: 'Une étape précédente n’a pas encore de résultat.' };
  }
  const images = (port: string) => values(port).flatMap(v => v?.assetIds ?? []);

  const prompt = resolveMentions(
    values('prompt')
      .map(v => v?.text?.trim() ?? '')
      .filter(Boolean)
      .join('\n\n'),
  );
  if (!prompt) return { ok: false, reason: 'Le prompt est vide.' };

  const references = images('references');
  let referenceAssetIds = references;
  let refMode: GenerationPlan['refMode'] = 'start-frame';
  if (node.type === 'video-gen') {
    const [start, end] = [images('start'), images('end')];
    if (references.length && (start.length || end.length)) {
      return { ok: false, reason: 'Choisis entre l’image de début (et de fin) et les références.' };
    }
    if (end.length && !start.length) return { ok: false, reason: 'Une image de fin demande une image de début.' };
    if (references.length) refMode = 'reference';
    else referenceAssetIds = [...start.slice(0, 1), ...end.slice(0, 1)];
  }

  const params = node.data.params && typeof node.data.params === 'object' ? (node.data.params as Record<string, unknown>) : {};
  return { ok: true, plan: { family, params, prompt, referenceAssetIds, refMode } };
}

// ── Mentions « @image2 » ──────────────────────────────────────

/** Une image reçue par un nœud de génération, avec son numéro (celui que le prompt cite). */
export interface ImageSlot {
  n: number;
  sourceId: string;
  /** Pour une sortie qui fournit plusieurs images (Image source) : rang de l'image. */
  index: number;
  /** Image d'une entrée « À fournir » : connue seulement au lancement. */
  pending?: boolean;
}

/**
 * Images envoyées par un nœud Générer image / vidéo, dans l'ordre d'envoi. Même ordre que
 * `generationPlan` : références (dans l'ordre des liens), sinon image de début puis de fin.
 */
export function imageSlots(graph: WorkflowGraph, nodeId: string): ImageSlot[] {
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node || (node.type !== 'image-gen' && node.type !== 'video-gen')) return [];
  const byId = new Map(graph.nodes.map(n => [n.id, n]));
  const refs = edgesInto(graph, nodeId, 'references');
  const edges =
    node.type === 'video-gen' && !refs.length
      ? [...edgesInto(graph, nodeId, 'start').slice(0, 1), ...edgesInto(graph, nodeId, 'end').slice(0, 1)]
      : refs;
  const slots: ImageSlot[] = [];
  for (const e of edges) {
    const source = byId.get(e.source);
    const count = imagesCarried(source);
    const pending = source ? isExposed(source) : false;
    for (let i = 0; i < count; i++) {
      slots.push({ n: slots.length + 1, sourceId: e.source, index: i, ...(pending ? { pending } : {}) });
    }
  }
  return slots;
}

/** Mentions écrites dans un prompt : « @image2 » (insensible à la casse). */
export const MENTION_RE = /@image(\d+)/gi;

/** Envoyé au modèle : « @image2 » devient « image 2 », la formulation que les modèles comprennent. */
export const resolveMentions = (text: string) => text.replace(MENTION_RE, (_, n: string) => `image ${n}`);

/**
 * Nombre d'images portées par une sortie : celles d'un nœud Image source (au moins une
 * s'il est « À fournir » : on la donnera au lancement), sinon une.
 */
export function imagesCarried(source: WorkflowNode | undefined): number {
  if (source?.type !== 'image-source') return 1;
  // « À fournir » : le nombre maximum d'images réglé dans le nœud.
  if (source.data.exposed === true) return maxImagesOf(source);
  return strings(source.data.assetIds).length;
}

// ── Anciens graphes ───────────────────────────────────────────

/**
 * Graphe enregistré avant la fin du nœud Persona : chaque nœud Persona devient un nœud
 * Image source avec ses photos cochées (son lien « Persona » disparaît), et une Image
 * source à une image (`assetId`) passe à plusieurs (`assetIds`). Sans effet sur un graphe à jour.
 */
export function normalizeGraph(graph: WorkflowGraph): WorkflowGraph {
  const legacy = new Set(graph.nodes.filter(n => (n.type as string) === 'persona').map(n => n.id));
  const nodes = graph.nodes.map(n => {
    if (legacy.has(n.id)) return { ...n, type: 'image-source' as const, data: { assetIds: strings(n.data.referenceIds) } };
    if (n.type === 'image-source' && 'assetId' in n.data) {
      const { assetId, ...rest } = n.data;
      return { ...n, data: { ...rest, assetIds: str(assetId) ? [str(assetId)] : strings(n.data.assetIds) } };
    }
    return n;
  });
  const edges = graph.edges
    .filter(e => !(legacy.has(e.source) && e.sourceHandle === 'persona') && e.targetHandle !== 'persona')
    .map(e => (legacy.has(e.source) && e.sourceHandle === 'images' ? { ...e, sourceHandle: 'image' } : e));
  return { ...graph, nodes, edges };
}

// ── Nœuds de texte IA ─────────────────────────────────────────

/** Ce qu'il faut pour lancer un nœud Décrire une image ou Texte IA. */
export interface TextPlan {
  kind: 'describe' | 'llm';
  model: string;
  /** Message envoyé au modèle de texte. */
  text: string;
  imageIds: string[];
}

export function textPlan(
  graph: WorkflowGraph,
  nodeId: string,
  valueOf: (sourceId: string, port: string) => PortValue | null,
): { ok: true; plan: TextPlan } | { ok: false; reason: string } {
  const node = graph.nodes.find(n => n.id === nodeId);
  if (!node || (node.type !== 'describe' && node.type !== 'llm')) return { ok: false, reason: 'Nœud introuvable.' };
  const values = (port: string) => edgesInto(graph, nodeId, port).map(e => valueOf(e.source, e.sourceHandle));
  if ([...values('images'), ...values('text')].some(v => v === null)) {
    return { ok: false, reason: 'Une étape précédente n’a pas encore de résultat.' };
  }
  const imageIds = values('images').flatMap(v => v?.assetIds ?? []);
  const instruction = resolveMentions(str(node.data.instruction).trim());
  const model = str(node.data.model) || WORKFLOW_TEXT_MODEL_DEFAULT;

  if (node.type === 'describe') {
    if (!imageIds.length) return { ok: false, reason: 'Relie au moins une image à décrire.' };
    const text = instruction ? `Décris ces images. Insiste sur : ${instruction}` : 'Décris ces images.';
    return { ok: true, plan: { kind: 'describe', model, text, imageIds } };
  }
  const source = values('text')
    .map(v => v?.text?.trim() ?? '')
    .filter(Boolean)
    .join('\n\n');
  if (!source) return { ok: false, reason: 'Le texte à traiter est vide.' };
  if (!instruction) return { ok: false, reason: 'Écris une consigne.' };
  return { ok: true, plan: { kind: 'llm', model, text: `Consigne : ${instruction}\n\nTexte :\n${resolveMentions(source)}`, imageIds } };
}

// ── Entrées « À fournir » (workflow utilisé depuis un fil) ────

/** Entrée d'un workflow à remplir au lancement (nœud Texte ou Image source « À fournir »). */
export interface WorkflowInput {
  nodeId: string;
  kind: 'text' | 'image';
  /** Libellé affiché dans le formulaire. */
  label: string;
  /** Valeur du nœud dans le workflow : proposée par défaut. */
  defaultText: string;
  defaultAssetIds: string[];
  /** Images : nombre maximum fourni au lancement (fixe le prix, réserve les numéros @image). */
  maxImages: number;
}

/** Bornes du nombre d'images d'une entrée « À fournir ». */
export const INPUT_MAX_IMAGES = { min: 1, max: 10 } as const;

/** Nombre maximum d'images d'une Image source « À fournir » (1 par défaut). */
export function maxImagesOf(node: WorkflowNode): number {
  const n = Math.round(Number(node.data.maxImages));
  return Number.isFinite(n) && n >= INPUT_MAX_IMAGES.min ? Math.min(INPUT_MAX_IMAGES.max, n) : INPUT_MAX_IMAGES.min;
}

/** Valeur saisie pour une entrée. */
export interface WorkflowInputValue {
  text?: string;
  assetIds?: string[];
}

export const isExposed = (node: WorkflowNode) =>
  (node.type === 'text' || node.type === 'image-source') && node.data.exposed === true;

/** Entrées à fournir, dans l'ordre du canvas (de haut en bas, puis de gauche à droite). */
export function workflowInputs(graph: WorkflowGraph): WorkflowInput[] {
  return graph.nodes
    .filter(isExposed)
    .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
    .map(n => ({
      nodeId: n.id,
      kind: n.type === 'text' ? ('text' as const) : ('image' as const),
      label: str(n.data.label).trim(),
      defaultText: str(n.data.text),
      defaultAssetIds: strings(n.data.assetIds),
      maxImages: maxImagesOf(n),
    }));
}

/** Pourquoi ce workflow ne peut pas encore servir dans un fil (null : il peut). */
export function threadUsableError(graph: WorkflowGraph): string | null {
  const inputs = workflowInputs(graph);
  if (!inputs.length) return 'Aucune entrée « À fournir » : active-la sur un nœud Texte ou Image source.';
  if (inputs.some(i => !i.label)) return 'Chaque entrée « À fournir » a besoin d’un libellé.';
  return null;
}

/**
 * Graphe à exécuter avec les valeurs saisies : chaque entrée prend la valeur donnée, ou sa
 * valeur par défaut. Le workflow enregistré n'est pas modifié.
 */
export function applyInputs(
  graph: WorkflowGraph,
  values: Record<string, WorkflowInputValue>,
): { ok: true; graph: WorkflowGraph } | { ok: false; reason: string } {
  const inputs = new Map(workflowInputs(graph).map(i => [i.nodeId, i]));
  for (const id of Object.keys(values)) {
    if (!inputs.has(id)) return { ok: false, reason: 'Cette entrée n’existe pas dans le workflow.' };
  }
  const nodes = graph.nodes.map(n => {
    const input = inputs.get(n.id);
    if (!input) return n;
    const v = values[n.id];
    if (input.kind === 'text') {
      const text = v?.text !== undefined ? v.text : input.defaultText;
      return { ...n, data: { ...n.data, text } };
    }
    const assetIds = v?.assetIds !== undefined ? v.assetIds : input.defaultAssetIds;
    return { ...n, data: { ...n.data, assetIds } };
  });
  const result = { ...graph, nodes };
  for (const input of inputs.values()) {
    const node = nodes.find(n => n.id === input.nodeId)!;
    const empty = input.kind === 'text' ? !str(node.data.text).trim() : !strings(node.data.assetIds).length;
    if (empty) return { ok: false, reason: `« ${input.label || 'Entrée'} » est vide.` };
    if (input.kind === 'image' && strings(node.data.assetIds).length > input.maxImages) {
      return {
        ok: false,
        reason: `« ${input.label} » : ${input.maxImages} image${input.maxImages > 1 ? 's' : ''} au maximum.`,
      };
    }
  }
  return { ok: true, graph: result };
}

/**
 * Nœuds dont les résultats sont le résultat final : les sources des nœuds Résultat, sinon
 * les nœuds payants qui ne mènent à rien.
 */
export function finalNodeIds(graph: WorkflowGraph): string[] {
  const outputs = graph.nodes.filter(n => n.type === 'output').map(n => n.id);
  if (outputs.length) {
    return [...new Set(graph.edges.filter(e => outputs.includes(e.target)).map(e => e.source))];
  }
  const sources = new Set(graph.edges.map(e => e.source));
  return graph.nodes.filter(n => isPaidNode(n) && !sources.has(n.id)).map(n => n.id);
}

/**
 * Valeurs types d'un formulaire, pour chiffrer le workflow avant toute saisie : chaque
 * texte (sa valeur par défaut, sinon un mot), chaque entrée image avec son nombre maximum
 * d'images. Le prix ne dépend donc pas de ce que la personne remplit.
 */
export function templateInputs(graph: WorkflowGraph, standInImageId: string): Record<string, WorkflowInputValue> {
  return Object.fromEntries(
    workflowInputs(graph).map(i => [
      i.nodeId,
      i.kind === 'text'
        ? { text: i.defaultText.trim() || 'texte' }
        : { assetIds: Array.from({ length: i.maxImages }, () => standInImageId) },
    ]),
  );
}
