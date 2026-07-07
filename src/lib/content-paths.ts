// ── Content roots ────────────────────────────────────────────────────────────
//
// LifeOS has two content roots:
//
//   1. The **machine store** — `src/content/` (cwd-relative). Job plumbing
//      (locks, logs, pending agent output), caches and derived state that no
//      human edits: product-map, purchases, carts, category-map, order-history,
//      widgets/registry, settings/*, deliveries/dismissed, every dot-file.
//      Resolved relative to process.cwd() so the test sandbox (which chdir's
//      into a copy) keeps working unchanged.
//
//   2. The **vault** — an Obsidian vault of human-facing content as Markdown:
//      recipes, the grocery list + staples, deliveries, the daily briefing and
//      tasks. Lives outside the repo so Obsidian (and its sync) own it.
//      Location is `LIFEOS_VAULT_DIR`, defaulting to ~/obsidian/lifeos. The
//      test sandbox points this at a throwaway copy so tests never touch the
//      real vault.

import { homedir } from 'os';
import { join } from 'path';

/** Root of the machine store (job plumbing, caches, derived state). */
export function contentDir(): string {
  return join(process.cwd(), 'src/content');
}

/** A sub-path inside the machine store. */
export function contentPath(...parts: string[]): string {
  return join(contentDir(), ...parts);
}

/** Root of the Obsidian vault holding human Markdown content. */
export function vaultDir(): string {
  return process.env.LIFEOS_VAULT_DIR || join(homedir(), 'obsidian', 'lifeos');
}

/** A sub-path inside the vault (e.g. vaultPath('recipes') ). */
export function vaultPath(...parts: string[]): string {
  return join(vaultDir(), ...parts);
}
