import { describe, expect, it } from 'vitest';
import { makeZip } from '../test/zip.js';
import { WILDCARD_MAX_ITEMS, cleanLine, expandChoices, looksLikeTags, parseWildcardYaml, resolveDynamic, unzip, wildcardLists } from './wildcards.js';

describe('wildcards', () => {
  it('lit une archive zip ; refuse un fichier qui n’en est pas une', () => {
    const files = unzip(makeZip({ 'a.txt': 'un\ndeux', 'dossier/b.txt': 'trois' }));
    expect(files.map(f => [f.name, f.data.toString()])).toEqual([
      ['a.txt', 'un\ndeux'],
      ['dossier/b.txt', 'trois'],
    ]);
    expect(() => unzip(Buffer.from('{"error":"pas un zip"}'))).toThrow('Archive illisible.');
  });

  it('lignes : commentaires et renvois écartés, tirets bas en espaces', () => {
    expect(cleanLine('silk_corset_top')).toBe('silk corset top');
    expect(cleanLine('  - "robe rouge"  ')).toBe('robe rouge');
    expect(cleanLine('# commentaire')).toBeNull();
    expect(cleanLine('__couleurs__ dress')).toBeNull();
    expect(cleanLine('   ')).toBeNull();
  });

  it('syntaxe Stable Diffusion : choix tirés, poids, lora, BREAK et tags de qualité retirés', () => {
    const first = () => 0;
    expect(resolveDynamic('laboratory{, loaded interior|}{, bookshelf|, shelf|}', first)).toBe('laboratory, loaded interior, bookshelf');
    expect(resolveDynamic('a {2$$x|y|z} b', () => 0.99)).toBe('a z b');
    expect(cleanLine('indoors, laboratory{, loaded interior|}{, window|}', first)).toBe('indoors, laboratory, loaded interior, window');
    expect(cleanLine('masterpiece, best quality, 1girl, solo, (red_dress:1.3), <lora:abc:0.8> BREAK beach', first)).toBe('red dress, beach');
    expect(looksLikeTags(['a, b, c', 'd, e, f', 'g'])).toBe(true);
    // Une ligne faite d'un seul grand choix : un élément par option.
    expect(expandChoices('{robe rouge|jean {bleu|noir}|short}')).toEqual(['robe rouge', 'jean {bleu|noir}', 'short']);
    expect(expandChoices('{a|b} et {c|d}')).toEqual(['{a|b} et {c|d}']);
    expect(expandChoices('- {2$$a|b}')).toEqual(['a', 'b']);
    // Options pondérées : le poids disparaît, une option vide est écartée.
    expect(expandChoices('{5.0::belt pouch|5.0::|2::rope}').map(l => cleanLine(l))).toEqual(['belt pouch', 'rope']);
    expect(cleanLine('1.5::colorful background, 1.0::concentric circles')).toBe('colorful background, concentric circles');
    expect(looksLikeTags(['une robe rouge', 'un jean bleu, délavé'])).toBe(false);
  });

  it('YAML : une liste par clé, le nom du pack omis quand il est seul', () => {
    const yaml = 'pack:\n  tops:\n    - a\n    - b\n  bottoms:\n    # rien\n    - c\n';
    expect(parseWildcardYaml(yaml)).toEqual([
      { path: ['tops'], lines: ['a', 'b'] },
      { path: ['bottoms'], lines: ['c'] },
    ]);
    expect(parseWildcardYaml('couleurs:\n  - rouge\nmatières:\n  - lin\n').map(l => l.path)).toEqual([['couleurs'], ['matières']]);
  });

  it('listes d’une archive : .txt et .yaml, doublons retirés, README ignoré, tirage au-delà du maximum', () => {
    const big = Array.from({ length: WILDCARD_MAX_ITEMS + 500 }, (_, i) => `tenue_${i}`).join('\n');
    const lists = wildcardLists(
      makeZip({
        'couleurs.txt': 'rouge\nrouge\nbleu\n',
        'pack.yaml': 'pack:\n  tops:\n    - a\n',
        'README.md': '# Lisez-moi',
        'tenues_ete.txt': big,
        'autre/couleurs.txt': 'vert',
      }),
    );
    expect(lists.map(l => l.format)).toEqual(['text', 'text', 'text', 'text']);
    expect(lists.map(l => [l.name, l.total, l.items.length])).toEqual([
      ['couleurs', 2, 2],
      ['couleurs (2)', 1, 1],
      ['tenues ete', WILDCARD_MAX_ITEMS + 500, WILDCARD_MAX_ITEMS],
      ['tops', 1, 1],
    ]);
    expect(lists[2].items[0]).toMatch(/^tenue \d+$/);
  });
});
