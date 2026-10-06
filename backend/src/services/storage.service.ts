/**
 * Stockage local des médias. Seul point d'accès au disque : le jour où l'app
 * est déployée, on remplace cette implémentation par un stockage objet (S3/R2).
 */
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export const ACCEPTED_UPLOAD_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']);
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 90 * 1024 * 1024;

export function extFor(mime: string): string {
  return EXT_BY_MIME[mime] ?? mime.split('/')[1] ?? 'bin';
}

export function mediaTypeOf(mime: string): 'image' | 'video' {
  return mime.startsWith('video/') ? 'video' : 'image';
}

export async function saveFile(path: string, data: Uint8Array): Promise<{ path: string; bytes: number }> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
  return { path, bytes: data.byteLength };
}

export async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

export function dayFolder(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export { join };
