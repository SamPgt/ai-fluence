/**
 * Wildcards : listes d'éléments (une par fichier .txt, une par clé d'un .yaml), livrées
 * par Civitai dans une archive zip. Lecture sans dépendance : le zip avec zlib, le YAML
 * des wildcards (clés imbriquées et listes « - élément ») avec un petit lecteur dédié.
 */
import { inflateRawSync } from 'node:zlib';
import type { WildcardList } from '@sublime/shared';

/** Taille décompressée maximale d'un fichier de l'archive (contre les archives piégées). */
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Éléments gardés par liste : au-delà, un tirage au hasard (dans l'esprit des wildcards). */
export const WILDCARD_MAX_ITEMS = 2000;

/** Fichiers d'une archive zip (stockés ou compressés « deflate » ; le zip64 n'est pas lu). */
export function unzip(buf: Buffer): { name: string; data: Buffer }[] {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Archive illisible.');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files: { name: string; data: Buffer }[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Archive illisible.');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (method === 0) files.push({ name, data: raw });
    else if (method === 8) files.push({ name, data: inflateRawSync(raw, { maxOutputLength: MAX_FILE_BYTES }) });
  }
  return files;
}

/** Tags de qualité ou de comptage propres à Stable Diffusion, inutiles pour nos modèles. */
const SD_TAG =
  /^(masterpiece|best quality|high quality|top quality|highres|absurdres|ultra[ -]detailed|very aesthetic|newest|8k|4k|hdr|uhd|score \d+( up)?|rating \w+|source \w+|\d+(girl|boy|other)s?|solo( focus)?)$/i;

/**
 * Syntaxe des wildcards dynamiques résolue par un tirage : « {, loaded interior|} » donne
 * « , loaded interior » ou rien, « {jar|bottle} » l'un des deux (« {2$$a|b} » : un seul).
 */
export function resolveDynamic(text: string, random: () => number = Math.random): string {
  let out = text;
  for (let guard = 0; guard < 50 && /\{[^{}]*\}/.test(out); guard++) {
    out = out.replace(/\{([^{}]*)\}/g, (_, body: string) => {
      const options = body.replace(/^\d+(-\d+)?\$\$/, '').split('|');
      return options[Math.floor(random() * options.length)] ?? '';
    });
  }
  return out;
}

/** Poids d'une option (« 5.0::belt pouch »), syntaxe des wildcards pondérés. */
const OPTION_WEIGHT = /(^|[\s,{|])\d+(\.\d+)?::/g;

/**
 * Ligne faite d'un seul grand choix (« {robe|jean|short} ») : chaque option devient un
 * élément. Sinon la ligne telle quelle.
 */
export function expandChoices(line: string): string[] {
  const text = line.replace(/^\s*-\s+/, '').trim();
  if (!text.startsWith('{') || !text.endsWith('}')) return [line];
  const options: string[] = [];
  let depth = 0;
  let current = '';
  for (let i = 1; i < text.length - 1; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    // Le choix se referme avant la fin : ce n'est pas un seul grand choix.
    if (depth < 0) return [line];
    if (ch === '|' && depth === 0) {
      options.push(current);
      current = '';
    } else current += ch;
  }
  options.push(current);
  const filled = options.map(o => o.replace(/^\d+(-\d+)?\$\$/, '').trim()).filter(o => o.replace(OPTION_WEIGHT, '').trim());
  return filled.length > 1 ? filled : [line];
}

/**
 * Ligne de wildcard lisible : commentaires et renvois vers d'autres wildcards
 * (« __couleurs__ ») écartés ; syntaxe Stable Diffusion nettoyée (choix « {a|b} » tirés,
 * poids « (mot:1.2) », « <lora:…> », BREAK et tags de qualité retirés) ; tirets bas en
 * espaces (« silk_corset_top »).
 */
export function cleanLine(line: string, random: () => number = Math.random): string | null {
  const text = line.replace(/^\s*-\s+/, '').trim();
  if (!text || text.startsWith('#') || text.includes('__')) return null;
  const flat = resolveDynamic(text.replace(/^["']|["']$/g, '').replace(OPTION_WEIGHT, '$1'), random)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\bBREAK\b/g, ',')
    .replace(/\\([()[\]])/g, '$1')
    .replace(/\(([^():]+):[\d.]+\)/g, '$1')
    .replace(/[()[\]]/g, '')
    .replace(/_/g, ' ');
  const tags = flat
    .split(',')
    .map(t => t.replace(/\s+/g, ' ').trim())
    .filter(t => t && !SD_TAG.test(t));
  const clean = [...new Set(tags)].join(', ');
  return clean && clean.length <= 300 ? clean : null;
}

/** Liste au format Stable Diffusion : la plupart de ses éléments sont des suites de tags. */
export const looksLikeTags = (items: string[]) =>
  items.length > 0 && items.filter(i => i.split(',').length >= 3).length / items.length >= 0.5;

/**
 * Listes d'un YAML de wildcards : chaque suite de « - élément » sous une clé devient une
 * liste nommée par son chemin (« tenues / hauts »). Le premier niveau, souvent le nom du
 * pack, est omis quand il est seul.
 */
export function parseWildcardYaml(text: string): { path: string[]; lines: string[] }[] {
  const lists = new Map<string, { path: string[]; lines: string[] }>();
  const stack: { indent: number; key: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (line.startsWith('- ')) {
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const path = stack.map(s => s.key);
      const key = path.join('/');
      const list = lists.get(key) ?? { path, lines: [] };
      list.lines.push(line.slice(2));
      lists.set(key, list);
      continue;
    }
    const m = /^([^:]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    stack.push({ indent, key: m[1].trim().replace(/^["']|["']$/g, '') });
  }
  const all = [...lists.values()].filter(l => l.path.length);
  const roots = new Set(all.map(l => l.path[0]));
  return roots.size === 1 && all.every(l => l.path.length > 1) ? all.map(l => ({ ...l, path: l.path.slice(1) })) : all;
}

/** Au plus `max` éléments, tirés au hasard en gardant leur ordre. */
function sample(items: string[], max: number): string[] {
  if (items.length <= max) return items;
  const picked = new Set<number>();
  while (picked.size < max) picked.add(Math.floor(Math.random() * items.length));
  return items.filter((_, i) => picked.has(i));
}

const toList = (name: string, lines: string[]): WildcardList | null => {
  const items = [...new Set(lines.flatMap(expandChoices).map(l => cleanLine(l)).filter((l): l is string => l !== null))];
  return items.length
    ? { name, total: items.length, items: sample(items, WILDCARD_MAX_ITEMS), format: looksLikeTags(items) ? 'tags' : 'text' }
    : null;
};

/** Listes d'une archive de wildcards (.txt et .yaml ; le reste, comme un README, est ignoré). */
export function wildcardLists(zip: Buffer): WildcardList[] {
  const lists: WildcardList[] = [];
  for (const file of unzip(zip)) {
    const base = file.name.split('/').pop()!;
    const ext = base.toLowerCase().split('.').pop();
    const stem = base.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
    if (ext === 'txt') {
      const list = toList(stem, file.data.toString('utf8').split(/\r?\n/));
      if (list) lists.push(list);
    } else if (ext === 'yaml' || ext === 'yml') {
      for (const y of parseWildcardYaml(file.data.toString('utf8'))) {
        const list = toList(y.path.join(' / ').replace(/_/g, ' ') || stem, y.lines);
        if (list) lists.push(list);
      }
    }
  }
  lists.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  // Deux fichiers du même nom (un .txt et un .yaml, deux dossiers) : « tops », « tops (2) ».
  const seen = new Map<string, number>();
  return lists.map(l => {
    const n = (seen.get(l.name) ?? 0) + 1;
    seen.set(l.name, n);
    return n > 1 ? { ...l, name: `${l.name} (${n})` } : l;
  });
}
