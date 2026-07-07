// ── Markdown content store ───────────────────────────────────────────────────
//
// Read/write the vault's human content as Obsidian-style Markdown notes:
// a YAML frontmatter block (the structured fields) followed by an optional
// Markdown body. One note per item for collections (a task, a grocery item, a
// delivery), or a single note for singletons (the daily briefing).
//
// Mirrors content-store.ts's atomic-write discipline (temp file + rename) so a
// reader — the app, Obsidian, the Drive sync — never observes a half-written
// note. js-yaml round-trips nested fields (a task's `due`, the day's `weather`)
// that the recipe regex parser could not.

import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'fs/promises';
import { basename, dirname, join } from 'path';
import { load as yamlLoad, dump as yamlDump } from 'js-yaml';

export interface Note<T> {
  /** Parsed frontmatter. */
  data: T;
  /** Markdown body after the frontmatter (trimmed of leading blank lines). */
  body: string;
  /** Absolute path of the source file. */
  path: string;
  /** Bare filename, e.g. "milk.md". */
  file: string;
}

/** Strip undefined (js-yaml rejects it) and drop keys we never persist. */
function clean<T extends Record<string, unknown>>(data: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/** Split a raw note into { data, body }. Missing/!frontmatter → empty data. */
export function parseNote<T = Record<string, unknown>>(raw: string): { data: T; body: string } {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {} as T, body: raw.trim() };
  const data = (yamlLoad(m[1]) ?? {}) as T;
  return { data, body: (m[2] ?? '').replace(/^\n+/, '').trimEnd() };
}

/** Serialize frontmatter + optional body into a Markdown note string. */
export function serializeNote(data: Record<string, unknown>, body = ''): string {
  const fm = yamlDump(clean(data), { lineWidth: -1, sortKeys: false, noRefs: true }).trimEnd();
  const b = body.trim();
  return `---\n${fm}\n---\n${b ? `\n${b}\n` : ''}`;
}

let tmpSeed = 0;

/** Atomically write a note (frontmatter + body) to `path`. */
export async function writeNote(
  path: string,
  data: Record<string, unknown>,
  body = '',
): Promise<void> {
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${basename(path)}.${process.pid}.${tmpSeed++}.tmp`);
  await writeFile(tmp, serializeNote(data, body));
  try {
    await rename(tmp, path);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/** Read a single note, or null if it doesn't exist. */
export async function readNote<T = Record<string, unknown>>(path: string): Promise<Note<T> | null> {
  try {
    const raw = await readFile(path, 'utf-8');
    const { data, body } = parseNote<T>(raw);
    return { data, body, path, file: basename(path) };
  } catch {
    return null;
  }
}

/** Read every visible *.md note in a directory (dot-files skipped). */
export async function readCollection<T = Record<string, unknown>>(dir: string): Promise<Note<T>[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  const files = entries.filter((f) => f.endsWith('.md') && !f.startsWith('.'));
  const notes = await Promise.all(files.map((f) => readNote<T>(join(dir, f))));
  return notes.filter((n): n is Note<T> => n !== null);
}

/** Remove a note (no error if already gone). */
export async function removeNote(path: string): Promise<void> {
  await unlink(path).catch(() => {});
}

/**
 * Assign each item a unique, human-readable `<slug>.md` filename derived from
 * `name(item)` — so the vault browses like a normal Obsidian folder. Unique
 * slugs stay clean (`milk.md`); genuine collisions get a short suffix from the
 * item's canonical `id` (`do-something-3rq66.md`), then a numeric one only as a
 * last resort. Deterministic for a stable input order (callers pass a sorted
 * list), so a re-sync doesn't churn filenames.
 */
function resolveNoteNames<T>(
  items: T[],
  name: (item: T) => string,
  id: (item: T) => string,
): Map<T, string> {
  const base = items.map((i) => noteSlug(name(i)));
  const counts = new Map<string, number>();
  for (const b of base) counts.set(b, (counts.get(b) ?? 0) + 1);

  const used = new Set<string>();
  const out = new Map<T, string>();
  items.forEach((item, idx) => {
    let stem = base[idx];
    if ((counts.get(stem) ?? 0) > 1) {
      // A shared slug — disambiguate with a stable, id-derived suffix.
      stem = `${stem}-${noteSlug(id(item)).slice(-6) || 'x'}`;
    }
    let unique = stem;
    for (let n = 2; used.has(unique); n++) unique = `${stem}-${n}`;
    used.add(unique);
    out.set(item, `${unique}.md`);
  });
  return out;
}

/**
 * Sync a directory to exactly `items`, one Markdown note per item. Filenames are
 * human-readable slugs of `name(item)` — the canonical id lives in frontmatter,
 * not the filename, so notes browse and rename freely in Obsidian and readers
 * key off `data.id`. Any visible note whose filename is no longer produced is
 * removed. The one-note-per-item analogue of a single writeJson over a collection.
 */
export async function writeCollection<T extends object>(
  dir: string,
  items: T[],
  name: (item: T) => string,
  opts: { id?: (item: T) => string; body?: (item: T) => string } = {},
): Promise<void> {
  const id = opts.id ?? name;
  const body = opts.body ?? (() => '');
  await mkdir(dir, { recursive: true });

  const filenames = resolveNoteNames(items, name, id);
  const keep = new Set(filenames.values());
  let existing: string[] = [];
  try {
    existing = (await readdir(dir)).filter((f) => f.endsWith('.md') && !f.startsWith('.'));
  } catch {}
  await Promise.all(
    existing.filter((f) => !keep.has(f)).map((f) => removeNote(join(dir, f))),
  );
  await Promise.all(
    items.map((i) => writeNote(join(dir, filenames.get(i)!), i as Record<string, unknown>, body(i))),
  );
}

/** Filesystem-safe slug for note filenames derived from free text. */
export function noteSlug(s: string): string {
  return (s || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

/** The filename stem (no directory, no `.md`) — a note's Obsidian-native
 *  identity, used as a fallback id/name when a hand-authored note omits them. */
export function noteStem(file: string): string {
  return basename(file).replace(/\.md$/i, '');
}
