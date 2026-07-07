// Server-only helpers for the Deliveries stack — do NOT import from client
// components; browser-safe types/constants are in src/lib/deliveries-types.ts.
import { readFile, stat } from 'fs/promises';
import { writeJson } from '@/lib/content-store';
import { readCollection } from '@/lib/markdown-store';
import { contentPath, vaultPath } from '@/lib/content-paths';
import type { DeliveriesData, Delivery } from '@/features/deliveries/types';

export type * from '@/features/deliveries/types';

// Deliveries are human-facing content — one Markdown note per delivery in the
// vault. The dismissed list is machine state (UI toggle) and stays JSON in the
// machine store.
export const DELIVERIES_DIR = vaultPath('deliveries');
export const DISMISSED_FILE = contentPath('deliveries', 'dismissed.json');

export interface Dismissal { id: string; dismissedAt: string }

/** Atomically persist the dismissed list (the dismiss/restore write seam). */
export async function saveDismissed(dismissed: Dismissal[]): Promise<void> {
  await writeJson(DISMISSED_FILE, { dismissed });
}

/** Read the delivery notes with dismissed entries filtered out. Null if no sync has run yet. */
export async function loadDeliveries(): Promise<DeliveriesData | null> {
  const notes = await readCollection<Delivery>(DELIVERIES_DIR);
  if (notes.length === 0) return null;

  let dismissed: string[] = [];
  try {
    const raw = JSON.parse(await readFile(DISMISSED_FILE, 'utf-8'));
    dismissed = (raw.dismissed ?? []).map((d: { id: string }) => d.id);
  } catch {}

  // lastSynced = newest note mtime — more reliable than a timestamp the sync
  // skill writes into a field.
  let lastSynced = new Date(0).toISOString();
  for (const n of notes) {
    try {
      const m = (await stat(n.path)).mtime.toISOString();
      if (m > lastSynced) lastSynced = m;
    } catch {}
  }

  const all = notes.map(n => n.data).sort((a, b) => (a.id ?? '').localeCompare(b.id ?? ''));
  return {
    lastSynced,
    deliveries: all.filter(d => !dismissed.includes(d.id)),
    dismissed: all.filter(d => dismissed.includes(d.id)),
  };
}
