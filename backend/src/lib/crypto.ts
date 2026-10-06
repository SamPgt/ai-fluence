import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { env } from '../env.js';

const KEY = Buffer.from(env.APP_SECRET, 'hex');

/** Chiffre une valeur sensible (clé API) : `iv.tag.data` en base64url. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, data].map(b => b.toString('base64url')).join('.');
}

export function decryptSecret(payload: string): string {
  const [iv, tag, data] = payload.split('.').map(p => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** `sk-spicy-abcdef…1234` → `sk-spicy-••••1234`. */
export function apiKeyHint(key: string): string {
  const prefix = key.startsWith('sk-spicy-') ? 'sk-spicy-' : key.slice(0, 4);
  return `${prefix}••••${key.slice(-4)}`;
}
