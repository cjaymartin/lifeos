// ── Stack content store ──────────────────────────────────────────────────────
//
// The one encoding of the stack-content conventions:
//   - a stack's user-facing content lives in src/content/<stackId>/
//   - dot-prefixed files are agent/job plumbing (locks, logs, pending agent
//     output) — hidden from chat dumps and any other content listing

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { basename, dirname, join } from 'path';

/** Dot-prefixed content files are job plumbing, never user content. */
export function isHiddenContentFile(name: string): boolean {
  return name.startsWith('.');
}

// Per-process counter so concurrent writers to the same path never collide on
// a temp name (no Date/random needed — pid + counter is unique within a run).
let tmpCounterSeed = 0;

/**
 * Atomically write `data` as pretty JSON to `path`.
 *
 * The one encoding of "a src/content JSON write": serialize to a sibling temp
 * file in the same directory, then `rename(2)` it into place. rename is atomic
 * on POSIX, so a concurrent reader (the nodemon watcher, an agent job, the chat
 * assistant) always observes either the previous complete file or the new
 * complete file — never a truncated mid-write — and a crash before the rename
 * leaves the original untouched (issue #7 / NIM-6). The temp is dot-prefixed so
 * a stray one (e.g. after a crash) is hidden from chat dumps and content
 * listings, like other job plumbing.
 */
export async function writeJson(path: string, data: unknown): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${tmpCounterSeed++}.tmp`);
  await writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
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
