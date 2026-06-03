import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { AuthenticatorTransportFuture } from '@simplewebauthn/server';

const DATA_DIR = join(process.cwd(), 'data');
const CRED_PATH = join(DATA_DIR, 'passkeys.json');

export interface StoredCredential {
  id: string;
  publicKey: string;  // base64url-encoded Uint8Array
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  name: string;
  createdAt: string;
}

export async function loadCredentials(): Promise<StoredCredential[]> {
  try {
    const raw = await readFile(CRED_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export async function saveCredential(cred: StoredCredential): Promise<void> {
  const creds = await loadCredentials();
  const idx = creds.findIndex((c) => c.id === cred.id);
  if (idx >= 0) creds[idx] = cred;
  else creds.push(cred);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CRED_PATH, JSON.stringify(creds, null, 2), 'utf-8');
}

export async function updateCounter(id: string, counter: number): Promise<void> {
  const creds = await loadCredentials();
  const cred = creds.find((c) => c.id === id);
  if (cred) {
    cred.counter = counter;
    await writeFile(CRED_PATH, JSON.stringify(creds, null, 2), 'utf-8');
  }
}

export async function deleteCredential(id: string): Promise<void> {
  const creds = (await loadCredentials()).filter((c) => c.id !== id);
  await writeFile(CRED_PATH, JSON.stringify(creds, null, 2), 'utf-8');
}

export function toWebAuthnCredential(cred: StoredCredential) {
  return {
    id: cred.id,
    publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')) as Uint8Array & { BYTES_PER_ELEMENT: 1 },
    counter: cred.counter,
    transports: cred.transports,
  };
}

export function rpConfig() {
  const url = new URL(import.meta.env.PUBLIC_URL ?? 'http://localhost:4321');
  const rpID = import.meta.env.RP_ID ?? url.hostname;
  const origins = [
    import.meta.env.PUBLIC_URL,
    ...(import.meta.env.ALLOWED_ORIGINS?.split(',').map((s: string) => s.trim()) ?? []),
  ].filter(Boolean) as string[];
  return { rpID, origins };
}
