// ── Encrypted secrets store (AES-256-GCM) ────────────────────────────────────
//
// File: src/content/settings/secrets.json.enc — gitignored AND encrypted.
// Key:  SECRETS_KEY in .env — 64 hex chars. Generate once:
//         openssl rand -hex 32
//
// Sync fs on purpose: the file is tiny, and getTodoistToken() (called from the
// sync loop) needs a synchronous read path.

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type { AccountId, AccountSecrets, SecretsFile } from './settings-types';

export const SECRETS_FILE = join(process.cwd(), 'src/content/settings/secrets.json.enc');

function getKey(): Buffer | null {
  // process.env ONLY — never import.meta.env (which `astro build` would inline
  // into dist/, baking a real key into the build and letting the sandboxed test
  // server decrypt real secrets despite its env scrub — NIM-7).
  const hex = process.env.SECRETS_KEY ?? '';
  if (!/^[0-9a-fA-F]{64}$/.test(hex.trim())) return null;
  return Buffer.from(hex.trim(), 'hex');
}

export function secretsKeyConfigured(): boolean {
  return getKey() !== null;
}

export function loadSecrets(): SecretsFile {
  const key = getKey();
  if (!key || !existsSync(SECRETS_FILE)) return {};
  try {
    // v1:<iv hex>:<auth tag hex>:<ciphertext hex>
    const [v, ivHex, tagHex, dataHex] = readFileSync(SECRETS_FILE, 'utf-8').trim().split(':');
    if (v !== 'v1') return {};
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const plain = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return JSON.parse(plain.toString('utf-8'));
  } catch (err) {
    console.error('[secrets] decrypt failed (wrong SECRETS_KEY?):', (err as Error).message);
    return {};
  }
}

export function saveSecrets(secrets: SecretsFile): void {
  const key = getKey();
  if (!key) throw new Error('SECRETS_KEY is not configured — generate with: openssl rand -hex 32');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(secrets), 'utf-8'), cipher.final()]);
  mkdirSync(dirname(SECRETS_FILE), { recursive: true });
  writeFileSync(
    SECRETS_FILE,
    `v1:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data.toString('hex')}`,
    { mode: 0o600 },
  );
}

export function getAccountSecrets(id: AccountId): AccountSecrets {
  return loadSecrets()[id] ?? {};
}

export function setAccountSecrets(id: AccountId, patch: Partial<AccountSecrets>): void {
  const all = loadSecrets();
  const merged = { ...(all[id] ?? {}), ...patch };
  // dropping a field by passing undefined removes it
  for (const k of Object.keys(merged) as (keyof AccountSecrets)[])
    if (merged[k] === undefined || merged[k] === '') delete merged[k];
  all[id] = merged;
  saveSecrets(all);
}

export function clearAccountSecrets(id: AccountId): void {
  const all = loadSecrets();
  delete all[id];
  saveSecrets(all);
}
