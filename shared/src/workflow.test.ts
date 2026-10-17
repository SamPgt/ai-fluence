import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_NODES,
  WORKFLOW_NODE_GROUPS,
  connect,
  connectionError,
  applyInputs,
  finalNodeIds,
  templateInputs,
  generationPlan,
  graphErrors,
  threadUsableError,
  workflowInputs,
  normalizeGraph,
  imageSlots,
  resolveMentions,
  missingInputs,
  paidSources,
  runOrder,
  staticOutput,
  topologicalOrder,
  expectedListSize,
  fanOut,
  isListOutput,
  splitList,
  listEntries,
  manualItems,
  shuffleActive,
  valueResolver,
  withListItems,
  listSlots,
  type PortValue,
  type WorkflowGraph,
  type WorkflowNodeType,
} from './workflow';

const node = (id: string, type: WorkflowNodeType) => ({ id, type, position: { x: 0, y: 0 }, data: {} });
const edge = (source: string, sourceHandle: string, target: string, targetHandle: string) => ({
  id: `${source}.${sourceHandle}-${target}.${targetHandle}`,
  source,
  sourceHandle,
  target,
  targetHandle,
});

/** Texte → image → vidéo, plus deux images sources libres. */
const base = (): WorkflowGraph => ({
  nodes: [
    node('t', 'text'),
    node('src', 'image-source'),
    node('p', 'image-source'),
    node('img', 'image-gen'),
    node('vid', 'video-gen'),
    node('d', 'describe'),
  ],
  edges: [edge('t', 'text', 'img', 'prompt'), edge('img', 'image', 'vid', 'start')],
});

describe('catalogue des nœuds', () => {
  it('chaque connecteur a un id unique dans son nœud ; les nœuds sources sont gratuits', () => {
    for (const def of Object.values(WORKFLOW_NODES)) {
      for (const ports of [def.inputs, def.outputs]) {
        expect(new Set(ports.map(p => p.id)).size, def.type).toBe(ports.length);
      }
      if (!def.inputs.length) expect(def.paid, def.type).toBe(false);
      // Chaque nœud est dans la palette, une seule fois.
      expect(WORKFLOW_NODE_GROUPS.flatMap(g => g.types).filter(t => t === def.type), def.type).toHaveLength(1);
    }
  });
});

describe('connectionError', () => {
  it('accepte texte → image, image → image, image → vidéo', () => {
    const g = base();
    expect(connectionError(g, edge('t', 'text', 'vid', 'prompt'))).toBeNull();
    expect(connectionError(g, edge('src', 'image', 'img', 'references'))).toBeNull();
    expect(connectionError(g, edge('src', 'image', 'vid', 'end'))).toBeNull();
    expect(connectionError(g, edge('p', 'image', 'd', 'images'))).toBeNull();
    expect(connectionError(g, edge('d', 'text', 'img', 'prompt'))).toBeNull();
  });

  it('refuse des types différents', () => {
    const g = base();
    expect(connectionError(g, edge('t', 'text', 'img', 'references'))).toMatch(/texte vers image/);
    expect(connectionError(g, edge('src', 'image', 'img', 'prompt'))).toMatch(/image vers texte/);
    expect(connectionError(g, edge('vid', 'video', 'd', 'images'))).toMatch(/vidéo vers image/);
  });

  it('refuse un connecteur inexistant ou pris à l’envers, un nœud absent, soi-même', () => {
    const g = base();
    expect(connectionError(g, edge('img', 'prompt', 'vid', 'start'))).toBe('Connecteur introuvable.');
    expect(connectionError(g, edge('vid', 'video', 'img', 'references'))).toMatch(/vidéo vers image/);
    expect(connectionError(g, edge('x', 'text', 'img', 'prompt'))).toBe('Nœud introuvable.');
    expect(connectionError(g, edge('img', 'image', 'img', 'references'))).toMatch(/lui-même/);
  });

  it('refuse un lien en double et une boucle', () => {
    const g = base();
    expect(connectionError(g, edge('t', 'text', 'img', 'prompt'))).toBe('Ce lien existe déjà.');
    // d décrit l'image générée, puis sert de prompt à cette même génération : boucle.
    const g2 = { ...g, edges: [...g.edges, edge('img', 'image', 'd', 'images')] };
    expect(connectionError(g2, edge('d', 'text', 'img', 'prompt'))).toBe('Ce lien créerait une boucle.');
  });
});

describe('nœud Résultat', () => {
  it('reçoit images et vidéos finales, n’est jamais lancé', () => {
    const g = base();
    g.nodes.push(node('out', 'output'));
    expect(connectionError(g, edge('img', 'image', 'out', 'images'))).toBeNull();
    expect(connectionError(g, edge('vid', 'video', 'out', 'videos'))).toBeNull();
    expect(connectionError(g, edge('src', 'image', 'out', 'images'))).toBeNull();
    expect(connectionError(g, edge('vid', 'video', 'out', 'images'))).toMatch(/vidéo vers image/);
    g.edges.push(edge('img', 'image', 'out', 'images'));
    expect(runOrder(g)).not.toContain('out');
  });
});

describe('connect', () => {
  it('entrée simple : le nouveau lien remplace l’ancien', () => {
    const g = connect(base(), edge('d', 'text', 'img', 'prompt'), 'new');
    expect(g.edges.filter(e => e.target === 'img' && e.targetHandle === 'prompt').map(e => e.id)).toEqual(['new']);
  });

  it('entrée multiple : les liens s’ajoutent', () => {
    let g = connect(base(), edge('src', 'image', 'img', 'references'), 'a');
    g = connect(g, edge('p', 'image', 'img', 'references'), 'b');
    expect(g.edges.filter(e => e.targetHandle === 'references').map(e => e.id)).toEqual(['a', 'b']);
  });
});

describe('topologicalOrder', () => {
  it('chaque nœud après ses dépendances, ordre stable sinon', () => {
    const g = base();
    const order = topologicalOrder(g)!;
    expect(order.indexOf('t')).toBeLessThan(order.indexOf('img'));
    expect(order.indexOf('img')).toBeLessThan(order.indexOf('vid'));
    expect(order).toEqual(['t', 'src', 'p', 'd', 'img', 'vid']);
  });

  it('boucle : null', () => {
    const g = base();
    g.edges.push(edge('img', 'image', 'd', 'images'), edge('d', 'text', 'img', 'prompt'));
    expect(topologicalOrder(g)).toBeNull();
  });
});

describe('missingInputs', () => {
  it('liste les entrées obligatoires sans lien', () => {
    const g = base();
    expect(missingInputs(g, 'img')).toEqual([]);
    // Le prompt n'est plus obligatoire (une liste peut le remplacer) : vérifié au devis.
    expect(missingInputs(g, 'vid')).toEqual([]);
    expect(missingInputs(g, 'd').map(p => p.id)).toEqual(['images']);
    expect(missingInputs(g, 't')).toEqual([]);
  });
});

describe('graphErrors', () => {
  it('graphe valide, même incomplet', () => {
    expect(graphErrors(base())).toEqual([]);
    expect(graphErrors({ nodes: [], edges: [] })).toEqual([]);
  });

  it('nœud en double, type inconnu, lien invalide, deux liens sur une entrée simple, boucle', () => {
    const g = base();
    g.nodes.push(node('t', 'text'), { ...node('z', 'text'), type: 'inconnu' as WorkflowNodeType });
    g.edges.push(
      edge('src', 'image', 'img', 'prompt'),
      edge('d', 'text', 'vid', 'prompt'),
      { ...edge('t', 'text', 'vid', 'prompt'), id: 'second' },
      edge('vid', 'video', 'd', 'images'),
    );
    const errors = graphErrors(g).join('\n');
    expect(errors).toMatch(/Nœud en double : t/);
    expect(errors).toMatch(/Type de nœud inconnu : inconnu/);
    expect(errors).toMatch(/image vers texte/);
    expect(errors).toMatch(/second : cette entrée n’accepte qu’un seul lien/);
    expect(errors).toMatch(/vidéo vers image/);
  });

  it('limites', () => {
    const nodes = Array.from({ length: 201 }, (_, i) => node(`n${i}`, 'text'));
    expect(graphErrors({ nodes, edges: [] })).toEqual(['200 nœuds au maximum.']);
  });
});

describe('exécution', () => {
  const graph = (): WorkflowGraph => ({
    nodes: [
      { ...node('t', 'text'), data: { text: '  une pomme  ' } },
      { ...node('s1', 'image-source'), data: { assetIds: ['a1'] } },
      { ...node('p', 'image-source'), data: { assetIds: ['r1', 'r2'] } },
      { ...node('img', 'image-gen'), data: { family: 'seedream', params: { aspect_ratio: '16:9' } } },
      { ...node('vid', 'video-gen'), data: { family: 'seedance' } },
    ],
    edges: [
      edge('t', 'text', 'img', 'prompt'),
      edge('p', 'image', 'img', 'references'),
      edge('s1', 'image', 'img', 'references'),
      edge('t', 'text', 'vid', 'prompt'),
      edge('img', 'image', 'vid', 'start'),
    ],
  });
  const g = graph();
  /** Valeur d'une sortie : réglages des nœuds d'entrée, sinon résultats donnés des nœuds payants. */
  const valueOf =
    (outputs: Record<string, PortValue | null>, of: WorkflowGraph = g) =>
    (id: string, port: string) =>
      staticOutput(of.nodes.find(n => n.id === id)!, port) ?? outputs[id] ?? null;

  it('ordre des nœuds payants, sources payantes d’un nœud', () => {
    expect(runOrder(g)).toEqual(['img', 'vid'])
    expect(runOrder(g, ['vid'])).toEqual(['vid'])
    expect(paidSources(g, 'vid')).toEqual(['img'])
    expect(paidSources(g, 'img')).toEqual([])
  })

  it('image : prompt, références dans l’ordre des liens (les deux images de p, puis s1), réglages', () => {
    const r = generationPlan(g, 'img', valueOf({}))
    expect(r).toEqual({
      ok: true,
      plan: {
        family: 'seedream',
        params: { aspect_ratio: '16:9' },
        prompt: 'une pomme',
        referenceAssetIds: ['r1', 'r2', 'a1'],
        refMode: 'start-frame',
      },
    })
  })

  it('vidéo : l’image générée en amont sert d’image de début ; sans résultat, refus', () => {
    expect(generationPlan(g, 'vid', valueOf({}))).toEqual({ ok: false, reason: 'Une étape précédente n’a pas encore de résultat.' })
    const r = generationPlan(g, 'vid', valueOf({ img: { assetIds: ['out1'] } }))
    expect(r.ok && r.plan.referenceAssetIds).toEqual(['out1'])
    expect(r.ok && r.plan.refMode).toBe('start-frame')
  })

  it('vidéo : références → mode référence ; début et références ensemble refusés ; fin sans début refusée', () => {
    const withRefs = graph()
    withRefs.edges = withRefs.edges.filter(e => e.targetHandle !== 'start')
    withRefs.edges.push(edge('s1', 'image', 'vid', 'references'))
    const r = generationPlan(withRefs, 'vid', valueOf({}, withRefs))
    expect(r.ok && r.plan).toMatchObject({ refMode: 'reference', referenceAssetIds: ['a1'] })

    const both = graph()
    both.edges.push(edge('s1', 'image', 'vid', 'references'))
    expect(generationPlan(both, 'vid', valueOf({ img: { assetIds: ['out1'] } }, both))).toMatchObject({ ok: false, reason: expect.stringMatching(/Choisis entre/) })

    const endOnly = graph()
    endOnly.edges = endOnly.edges.filter(e => e.targetHandle !== 'start')
    endOnly.edges.push(edge('s1', 'image', 'vid', 'end'))
    expect(generationPlan(endOnly, 'vid', valueOf({}, endOnly))).toMatchObject({ ok: false, reason: expect.stringMatching(/image de fin/) })
  })

  it('refus clairs : sans modèle, prompt vide', () => {
    const noModel = graph()
    noModel.nodes[3].data = {}
    expect(generationPlan(noModel, 'img', valueOf({}, noModel))).toEqual({ ok: false, reason: 'Choisis un modèle.' })
    const empty = graph()
    empty.nodes[0].data = { text: '   ' }
    expect(generationPlan(empty, 'img', valueOf({}, empty))).toEqual({ ok: false, reason: 'Le prompt est vide.' })
  })
})

describe('mentions « @image2 »', () => {
  it('numéros des images reçues : une source à deux images, puis une autre, dans l’ordre des liens', () => {
    const g: WorkflowGraph = {
      nodes: [
        { ...node('p', 'image-source'), data: { assetIds: ['r1', 'r2'] } },
        { ...node('s', 'image-source'), data: { assetIds: ['a1'] } },
        node('img', 'image-gen'),
        node('vid', 'video-gen'),
      ],
      edges: [
        edge('p', 'image', 'img', 'references'),
        edge('s', 'image', 'img', 'references'),
        edge('s', 'image', 'vid', 'end'),
        edge('img', 'image', 'vid', 'start'),
      ],
    };
    expect(imageSlots(g, 'img')).toEqual([
      { n: 1, sourceId: 'p', index: 0 },
      { n: 2, sourceId: 'p', index: 1 },
      { n: 3, sourceId: 's', index: 0 },
    ]);
    // Vidéo sans références : image de début, puis de fin.
    expect(imageSlots(g, 'vid').map(x => x.sourceId)).toEqual(['img', 's']);
  });

  it('entrée « À fournir » sans image : compte pour une image, marquée « à fournir »', () => {
    const g: WorkflowGraph = {
      nodes: [
        { ...node('s', 'image-source'), data: { assetIds: [], exposed: true, label: 'Logo' } },
        { ...node('f', 'image-source'), data: { assetIds: ['a1'] } },
        node('img', 'image-gen'),
      ],
      edges: [edge('s', 'image', 'img', 'references'), edge('f', 'image', 'img', 'references')],
    };
    expect(imageSlots(g, 'img')).toEqual([
      { n: 1, sourceId: 's', index: 0, pending: true },
      { n: 2, sourceId: 'f', index: 0 },
    ]);
  });

  it('« @image2 » part au modèle comme « image 2 »', () => {
    expect(resolveMentions('colle @image1 sur @Image2, pas image3')).toBe('colle image 1 sur image 2, pas image3');
    const g: WorkflowGraph = {
      nodes: [{ ...node('t', 'text'), data: { text: 'logo @image1' } }, { ...node('img', 'image-gen'), data: { family: 'f' } }],
      edges: [edge('t', 'text', 'img', 'prompt')],
    };
    const r = generationPlan(g, 'img', (id, port) => staticOutput(g.nodes.find(n => n.id === id)!, port));
    expect(r.ok && r.plan.prompt).toBe('logo image 1');
  });
});

describe('anciens graphes', () => {
  it('un nœud Persona devient une Image source avec ses photos ; son lien Persona disparaît', () => {
    const legacy = {
      nodes: [
        { id: 'p', type: 'persona', position: { x: 0, y: 0 }, data: { personaId: 'lea', referenceIds: ['r1', 'r2'] } },
        { ...node('s', 'image-source'), data: { assetId: 'a1' } },
        node('img', 'image-gen'),
      ],
      edges: [
        edge('p', 'images', 'img', 'references'),
        edge('p', 'persona', 'img', 'persona'),
        edge('s', 'image', 'img', 'references'),
      ],
    } as unknown as WorkflowGraph;
    const g = normalizeGraph(legacy);
    expect(g.nodes.map(n => [n.id, n.type, n.data])).toEqual([
      ['p', 'image-source', { assetIds: ['r1', 'r2'] }],
      ['s', 'image-source', { assetIds: ['a1'] }],
      ['img', 'image-gen', {}],
    ]);
    expect(g.edges.map(e => `${e.source}.${e.sourceHandle}>${e.targetHandle}`)).toEqual(['p.image>references', 's.image>references']);
    expect(graphErrors(g)).toEqual([]);
    // Graphe déjà à jour : inchangé.
    expect(normalizeGraph(g)).toEqual(g);
  });
});

describe('entrées « À fournir »', () => {
  const g = (): WorkflowGraph => ({
    nodes: [
      { ...node('t', 'text'), position: { x: 0, y: 200 }, data: { text: 'défaut', exposed: true, label: 'Ce que dit le personnage' } },
      { ...node('s', 'image-source'), position: { x: 0, y: 0 }, data: { assetIds: ['a1'], exposed: true, label: 'Photo' } },
      { ...node('fixe', 'text'), data: { text: 'fixe' } },
      { ...node('img', 'image-gen'), data: { family: 'f' } },
      { ...node('vid', 'video-gen'), data: { family: 'v' } },
    ],
    edges: [edge('t', 'text', 'img', 'prompt'), edge('s', 'image', 'img', 'references'), edge('img', 'image', 'vid', 'start')],
  });

  it('liste les entrées de haut en bas, avec leur valeur par défaut', () => {
    expect(workflowInputs(g())).toEqual([
      { nodeId: 's', kind: 'image', label: 'Photo', defaultText: '', defaultAssetIds: ['a1'], maxImages: 1 },
      { nodeId: 't', kind: 'text', label: 'Ce que dit le personnage', defaultText: 'défaut', defaultAssetIds: [], maxImages: 1 },
    ]);
    expect(threadUsableError(g())).toBeNull();
  });

  it('utilisable dans un fil : au moins une entrée, chacune avec un libellé', () => {
    const none = g();
    none.nodes.forEach(n => (n.data.exposed = false));
    expect(threadUsableError(none)).toMatch(/Aucune entrée/);
    const noLabel = g();
    noLabel.nodes[0].data.label = '  ';
    expect(threadUsableError(noLabel)).toMatch(/libellé/);
  });

  it('valeurs saisies appliquées, défauts sinon ; refus d’une entrée inconnue ou vide', () => {
    const r = applyInputs(g(), { t: { text: 'bonjour' } });
    expect(r.ok && r.graph.nodes.find(n => n.id === 't')!.data.text).toBe('bonjour');
    expect(r.ok && r.graph.nodes.find(n => n.id === 's')!.data.assetIds).toEqual(['a1']);
    expect(applyInputs(g(), { fixe: { text: 'x' } })).toMatchObject({ ok: false });
    expect(applyInputs(g(), { s: { assetIds: [] } })).toEqual({ ok: false, reason: '« Photo » est vide.' });
    // Le graphe d'origine n'est pas modifié.
    const original = g();
    applyInputs(original, { t: { text: 'autre' } });
    expect(original.nodes[0].data.text).toBe('défaut');
  });

  it('images max : refus au-delà, numéros réservés, devis type avec ce nombre d’images', () => {
    const two = g();
    two.nodes[1].data.maxImages = 2;
    expect(applyInputs(two, { s: { assetIds: ['a', 'b'] } }).ok).toBe(true);
    expect(applyInputs(two, { s: { assetIds: ['a', 'b', 'c'] } })).toEqual({ ok: false, reason: '« Photo » : 2 images au maximum.' });
    expect(imageSlots(two, 'img').map(x => x.n)).toEqual([1, 2]);
    expect(templateInputs(two, 'stand')).toEqual({ s: { assetIds: ['stand', 'stand'] }, t: { text: 'défaut' } });
  });

  it('résultat final : sources des nœuds Résultat, sinon les nœuds payants qui ne mènent à rien', () => {
    expect(finalNodeIds(g())).toEqual(['vid']);
    const withOutput = g();
    withOutput.nodes.push(node('out', 'output'));
    withOutput.edges.push(edge('img', 'image', 'out', 'images'));
    expect(finalNodeIds(withOutput)).toEqual(['img']);
  });
});

describe('listes', () => {
  const withData = (n: ReturnType<typeof node>, data: Record<string, unknown>) => ({ ...n, data });
  /** Liste « Tenues » (3 éléments) → image → vidéo ; un texte pour la vidéo. */
  const listGraph = (): WorkflowGraph => ({
    nodes: [
      withData(node('l', 'list'), { items: '- robe rouge\n\n2. jean bleu\n• short blanc' }),
      withData(node('t', 'text'), { text: 'elle marche' }),
      withData(node('img', 'image-gen'), { family: 'f' }),
      withData(node('vid', 'video-gen'), { family: 'v' }),
      node('llm', 'llm'),
      node('l2', 'list'),
      node('o', 'output'),
    ],
    edges: [edge('l', 'items', 'img', 'lists'), edge('img', 'image', 'vid', 'start'), edge('t', 'text', 'vid', 'prompt')],
  });

  it('découpe un texte en éléments : puces et numéros retirés, lignes vides ignorées, maximum', () => {
    expect(splitList('- robe rouge\n\n2. jean bleu\n3) short\n* pull\n• veste')).toEqual(['robe rouge', 'jean bleu', 'short', 'pull', 'veste']);
    expect(splitList('a\nb\nc', 2)).toEqual(['a', 'b']);
  });

  it('sortie orange : le nœud Liste, et les nœuds payants qui en reçoivent une, en chaîne', () => {
    const g = listGraph();
    expect(isListOutput(g, 'l')).toBe(true);
    expect(isListOutput(g, 'img')).toBe(true);
    expect(isListOutput(g, 'vid')).toBe(true);
    expect(isListOutput(g, 't')).toBe(false);
    expect(expectedListSize(g, 'vid')).toBe(3);
  });

  it('entrée Listes : listes seulement ; le prompt les refuse ; plusieurs listes acceptées ; pas de liste dans une liste', () => {
    const g = listGraph();
    g.nodes.push(withData(node('l3', 'list'), { items: 'a\nb' }), withData(node('img2', 'image-gen'), { family: 'f' }));
    g.edges.push(edge('l3', 'items', 'img2', 'lists'));
    expect(connectionError(g, edge('t', 'text', 'img2', 'lists'))).toMatch(/attend une liste/);
    expect(connectionError(g, edge('l', 'items', 'img2', 'prompt'))).toMatch(/entrée Listes/);
    expect(connectionError(g, edge('l', 'items', 'img2', 'lists'))).toBeNull();
    expect(connectionError(g, edge('img2', 'image', 'vid', 'references'))).toBeNull();
    expect(connectionError(g, edge('img', 'image', 'o', 'images'))).toBeNull();
    expect(connectionError(connect(g, edge('img', 'image', 'o', 'images'), 'e1'), edge('img2', 'image', 'o', 'images'))).toBeNull();
    // Texte IA démultiplié → Liste : refusé ; Texte IA simple → Liste : accepté.
    expect(connectionError(g, edge('llm', 'text', 'l2', 'text'))).toBeNull();
    const fanned = connect(g, edge('l', 'items', 'llm', 'text'), 'e2');
    expect(connectionError(fanned, edge('llm', 'text', 'l2', 'text'))).toMatch(/dans une autre liste/);
    // Dans l'autre sens : le Texte IA déjà relié à une Liste ne peut plus recevoir de liste.
    const feeding = connect(g, edge('llm', 'text', 'l2', 'text'), 'e3');
    expect(connectionError(feeding, edge('l', 'items', 'llm', 'text'))).toMatch(/dans une autre liste/);
    expect(graphErrors(g)).toEqual([]);
  });

  it('une passe par élément : la liste est remplacée par son élément', () => {
    const g = listGraph();
    const valueOf = valueResolver(g, () => null);
    const fan = fanOut(g, 'img', valueOf)!;
    expect(fan.list).toBe(true);
    expect(fan.items.map(i => i.label)).toEqual(['robe rouge', 'jean bleu', 'short blanc']);
    const plan = generationPlan(g, 'img', fan.items[1].valueOf);
    expect(plan.ok && plan.plan.prompt).toBe('jean bleu');
    // En aval : la vidéo reçoit la liste d'images, une passe par image.
    const images: PortValue = { items: fan.items.map((it, i) => ({ label: it.label, assetIds: [`a${i}`] })) };
    const down = fanOut(g, 'vid', valueResolver(g, id => (id === 'img' ? images : null)))!;
    expect(down.items).toHaveLength(3);
    const vplan = generationPlan(g, 'vid', down.items[2].valueOf);
    expect(vplan.ok && vplan.plan.referenceAssetIds).toEqual(['a2']);
    // Sans liste : une seule passe ; liste sans résultat : null.
    expect(fanOut(g, 'llm', valueOf)!.items).toHaveLength(1);
    expect(fanOut(g, 'vid', valueOf)).toBeNull();
  });

  it('liste écrite par un Texte IA : sa réponse découpée, au plus son maximum ; devis au maximum', () => {
    const g = listGraph();
    g.nodes = g.nodes.map(n => (n.id === 'l' ? withData(node('l', 'list'), { max: 2 }) : n));
    g.edges.push(edge('llm', 'text', 'l', 'text'));
    expect(paidSources(g, 'img')).toEqual(['llm']);
    expect(expectedListSize(g, 'img')).toBe(2);
    const answer = valueResolver(g, id => (id === 'llm' ? { text: '1. plage\n2. forêt\n3. ville' } : null));
    expect(answer('l', 'items')?.items?.map(i => i.text)).toEqual(['plage', 'forêt']);
    expect(valueResolver(g, () => null)('l', 'items')).toBeNull();
    const estimate = valueResolver(g, () => ({ text: 'x' }), { standIn: id => id === 'llm' });
    expect(estimate('l', 'items')?.items).toHaveLength(2);
  });

  it('éléments { texte, actif } : seuls les actifs sont envoyés ; une liste en texte est toute active', () => {
    const n = (items: unknown) => ({ ...node('l', 'list'), data: { items } });
    expect(listEntries(n('a\n- b'))).toEqual([
      { text: 'a', active: true },
      { text: 'b', active: true },
    ]);
    const entries = [
      { text: 'a', active: true },
      { text: ' b ', active: false },
      { text: '', active: true },
      { text: 'c' },
    ];
    expect(listEntries(n(entries))).toEqual([
      { text: 'a', active: true },
      { text: 'b', active: false },
      { text: 'c', active: true },
    ]);
    expect(manualItems(n(entries))).toEqual(['a', 'c']);
    const g: WorkflowGraph = { nodes: [n(entries), { ...node('img', 'image-gen'), data: { family: 'f' } }], edges: [edge('l', 'items', 'img', 'lists')] };
    expect(expectedListSize(g, 'img')).toBe(2);
  });

  it('Aléatoire : même nombre d’actifs, tirés dans toute la liste', () => {
    const entries = ['a', 'b', 'c', 'd', 'e'].map((text, i) => ({ text, active: i < 2 }));
    let seed = 0.7;
    const random = () => (seed = (seed * 9301 + 0.49297) % 1);
    const drawn = shuffleActive(entries, random);
    expect(drawn.filter(e => e.active)).toHaveLength(2);
    expect(drawn.map(e => e.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('@liste1 : remplacée par l’élément ; une liste non citée s’ajoute à la fin ; sans prompt, les éléments font le prompt', () => {
    expect(withListItems('Elle devant @liste1, avec @LISTE2', ['un café', 'un chapeau'])).toBe('Elle devant un café, avec un chapeau');
    expect(withListItems('Elle devant @liste1', ['un café', 'un chapeau'])).toBe('Elle devant un café\n\nun chapeau');
    expect(withListItems('', ['un café'])).toBe('un café');
    expect(withListItems('Elle et @liste3', ['un café'])).toBe('Elle et @liste3\n\nun café');
  });

  it('plusieurs listes avancent ensemble, rang par rang ; la plus courte reprend au début', () => {
    const g: WorkflowGraph = {
      nodes: [
        withData(node('fonds', 'list'), { items: 'café\nplage\nforêt' }),
        withData(node('objets', 'list'), { items: 'chapeau\nparapluie' }),
        withData(node('t', 'text'), { text: 'Elle devant @liste1 avec @liste2' }),
        withData(node('img', 'image-gen'), { family: 'f' }),
      ],
      edges: [edge('fonds', 'items', 'img', 'lists'), edge('objets', 'items', 'img', 'lists'), edge('t', 'text', 'img', 'prompt')],
    };
    expect(listSlots(g, 'img').map(s => [s.n, s.sourceId])).toEqual([
      [1, 'fonds'],
      [2, 'objets'],
    ]);
    expect(expectedListSize(g, 'img')).toBe(3);
    const fan = fanOut(g, 'img', valueResolver(g, () => null))!;
    expect(fan.items.map(i => i.label)).toEqual(['café · chapeau', 'plage · parapluie', 'forêt · chapeau']);
    const prompts = fan.items.map(i => {
      const r = generationPlan(g, 'img', i.valueOf);
      return r.ok ? r.plan.prompt : r.reason;
    });
    expect(prompts).toEqual(['Elle devant café avec chapeau', 'Elle devant plage avec parapluie', 'Elle devant forêt avec chapeau']);
    // Une liste vide : aucune passe.
    g.nodes[1] = withData(node('objets', 'list'), { items: '' });
    expect(fanOut(g, 'img', valueResolver(g, () => null))!.items).toEqual([]);
  });

  it('ancien graphe : une liste branchée sur le prompt passe sur l’entrée Listes', () => {
    const g: WorkflowGraph = {
      nodes: [withData(node('l', 'list'), { items: 'a' }), withData(node('t', 'text'), { text: 'x' }), node('img', 'image-gen')],
      edges: [edge('l', 'items', 'img', 'prompt'), edge('t', 'text', 'img', 'references')],
    };
    expect(normalizeGraph(g).edges.map(e => e.targetHandle)).toEqual(['lists', 'references']);
  });
});
