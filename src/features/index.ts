// ── Feature registry ─────────────────────────────────────────────────────────
//
// The home of the Feature concept (see types.ts). Everything that used to be
// scattered — sidebar stacks, chat tool config, chat guidance, agent-job
// ownership — derives from this list.

import { readFile } from 'fs/promises';
import { join } from 'path';
import type { Feature, FeatureStack } from './types';
import { tasksFeature } from './tasks/feature';
import { deliveriesFeature } from './deliveries/feature';
import { recipesFeature } from './recipes/feature';
import { groceryFeature } from './grocery/feature';
import { dailyFeature } from './daily/feature';
import { settingsFeature } from './settings/feature';

export type { Feature, FeatureStack } from './types';

/** Order matters: stack-bearing features render in the sidebar in this order. */
export const features: Feature[] = [
  tasksFeature,
  deliveriesFeature,
  recipesFeature,
  groceryFeature,
  dailyFeature,
  settingsFeature,
];

export function getFeature(id: string): Feature | undefined {
  return features.find((f) => f.id === id);
}

/* ── Stacks (derived) ───────────────────────────────────────────────────── */

export interface Stack extends FeatureStack {
  id: string;
}

/** Sidebar / chat-mount view of the registry: features that have a stack. */
export const stacks: Stack[] = features
  .filter((f): f is Feature & { stack: FeatureStack } => !!f.stack)
  .map((f) => ({ id: f.id, ...f.stack }));

/* ── Chat ───────────────────────────────────────────────────────────────── */

// Base tools every stack chat gets. Edit matters: models naturally reach for
// Edit on existing JSON files — without it every edit is permission-denied
// headless (and the model may claim success anyway).
export const CHAT_BASE_TOOLS = ['WebSearch', 'WebFetch', 'Read', 'Write', 'Edit'];

/**
 * A feature's chat guide (src/features/<id>/chat.md) — extra instructions
 * appended to the chat system prompt: data schemas, cross-stack reads, hard
 * rules like "never purchase". '' when the feature has none.
 */
export async function loadChatGuide(id: string): Promise<string> {
  try {
    return (await readFile(join(process.cwd(), 'src/features', id, 'chat.md'), 'utf-8')).trim();
  } catch {
    return '';
  }
}
