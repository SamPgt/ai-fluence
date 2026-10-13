import { describe, expect, it } from 'vitest';
import {
  WORKFLOW_NODES,
  WORKFLOW_NODE_GROUPS,
  connect,
  connectionError,
  generationPlan,
  graphErrors,
  normalizeGraph,
  imageSlots,
  resolveMentions,
  missingInputs,
  paidSources,
  runOrder,
  staticOutput,
  topologicalOrder,
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
    expect(missingInputs(g, 'vid').map(p => p.id)).toEqual(['prompt']);
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
