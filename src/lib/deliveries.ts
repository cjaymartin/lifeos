// Server-only helpers for the Deliveries stack — do NOT import from client
// components; browser-safe types/constants are in src/lib/deliveries-types.ts.
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import type { DeliveriesData } from '@/lib/deliveries-types';

export type * from '@/lib/deliveries-types';

export const DELIVERIES_FILE = join(process.cwd(), 'src/content/deliveries/deliveries.json');
export const DISMISSED_FILE = join(process.cwd(), 'src/content/deliveries/dismissed.json');

/** Read deliveries.json with dismissed entries filtered out. Null if no sync has run yet. */
export async function loadDeliveries(): Promise<DeliveriesData | null> {
  let data: DeliveriesData;
  try {
    data = JSON.parse(await readFile(DELIVERIES_FILE, 'utf-8'));
  } catch {
    return null;
  }

  let dismissed: string[] = [];
  try {
    const raw = JSON.parse(await readFile(DISMISSED_FILE, 'utf-8'));
    dismissed = (raw.dismissed ?? []).map((d: { id: string }) => d.id);
  } catch {}

  // Use the file's mtime for lastSynced — more reliable than the timestamp
  // the sync skill writes into the JSON
  let lastSynced = data.lastSynced;
  try {
    lastSynced = (await stat(DELIVERIES_FILE)).mtime.toISOString();
  } catch {}

  const all = data.deliveries ?? [];
  return {
    ...data,
    lastSynced,
    deliveries: all.filter(d => !dismissed.includes(d.id)),
    dismissed: all.filter(d => dismissed.includes(d.id)),
  };
}
