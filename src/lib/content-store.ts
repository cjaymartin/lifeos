// ── Stack content store ──────────────────────────────────────────────────────
//
// The one encoding of the stack-content conventions:
//   - a stack's user-facing content lives in src/content/<stackId>/
//   - dot-prefixed files are agent/job plumbing (locks, logs, pending agent
//     output) — hidden from chat dumps and any other content listing

import { readdir, readFile } from 'fs/promises';
import { join } from 'path';

/** Dot-prefixed content files are job plumbing, never user content. */
export function isHiddenContentFile(name: string): boolean {
  return name.startsWith('.');
}

/** A stack's visible content (md/json) concatenated for the chat prompt. */
export async function loadStackContent(stackId: string): Promise<string> {
  const dir = join(process.cwd(), 'src/content', stackId);
  try {
    const entries = await readdir(dir);
    const files = entries.filter(
      (f) => !isHiddenContentFile(f) && (f.endsWith('.md') || f.endsWith('.json')),
    );
    if (files.length === 0) return '(no content yet)';
    const contents = await Promise.all(
      files.map(async (f) => {
        const raw = await readFile(join(dir, f), 'utf-8');
        return `### ${f}\n${raw}`;
      }),
    );
    return contents.join('\n\n---\n\n');
  } catch {
    return '(no content yet)';
  }
}
