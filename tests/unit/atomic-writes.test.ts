// Atomicity contract for the shared content-store writeJson helper (issue #7 /
// NIM-6). A concurrent reader (nodemon watcher, agent job, chat assistant) must
// never observe a target file mid-write — only the previous complete JSON or
// the new complete JSON. The guarantee is "write to a sibling temp, then
// rename(2) into place": rename is atomic on POSIX, so the target is swapped
// whole and is never truncated.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync, writeFileSync, readFileSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeJson } from '@/lib/content-store';

let dir: string;
let target: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lifeos-atomic-'));
  target = join(dir, 'dismissed.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('writeJson — atomic content-store writes', () => {
  it('swaps in a new file via rename (never truncates the target in place)', async () => {
    // Seed an existing complete file and remember its inode.
    writeFileSync(target, JSON.stringify({ dismissed: [] }) + '\n');
    const inoBefore = statSync(target).ino;

    await writeJson(target, { dismissed: [{ id: 'a', dismissedAt: '2026-06-08' }] });

    // A naive writeFile(target, ...) truncates and rewrites the SAME inode —
    // the window in which a reader sees a half-written file. An atomic
    // temp+rename swaps in a brand-new file, so the inode must change.
    const inoAfter = statSync(target).ino;
    expect(inoAfter).not.toBe(inoBefore);
  });

  it('round-trips the data as pretty JSON with a trailing newline', async () => {
    const data = { dismissed: [{ id: 'x', dismissedAt: '2026-06-08' }] };
    await writeJson(target, data);
    const raw = readFileSync(target, 'utf-8');
    expect(JSON.parse(raw)).toEqual(data);
    expect(raw).toBe(JSON.stringify(data, null, 2) + '\n');
  });

  it('creates the parent directory if it does not exist', async () => {
    const nested = join(dir, 'deliveries', 'dismissed.json');
    await writeJson(nested, { dismissed: [] });
    expect(JSON.parse(readFileSync(nested, 'utf-8'))).toEqual({ dismissed: [] });
  });

  it('leaves no temp files behind once the write commits', async () => {
    await writeJson(target, { dismissed: [] });
    const leftovers = readdirSync(dir).filter((f) => f.endsWith('.tmp'));
    expect(leftovers).toEqual([]);
  });

  it('a concurrent reader never observes a truncated file (the #7 symptom)', async () => {
    // Reproduce the dismiss/restore round-trip pressure: many overlapping
    // writes of a sizeable payload while a reader polls in a tight loop. With
    // direct writes the reader periodically catches a zero-length/partial file
    // and throws "Unexpected end of JSON input"; with atomic writes it never
    // sees anything but a complete document.
    writeFileSync(target, JSON.stringify({ dismissed: [] }) + '\n');
    const big = (n: number) => ({
      dismissed: Array.from({ length: 800 }, (_, i) => ({
        id: `d-${n}-${i}`,
        dismissedAt: '2026-06-08T00:00:00.000Z',
        note: 'x'.repeat(40),
      })),
    });

    let stop = false;
    let reads = 0;
    const parseErrors: string[] = [];
    const reader = (async () => {
      while (!stop) {
        try {
          JSON.parse(await readFile(target, 'utf-8'));
          reads++;
        } catch (err) {
          parseErrors.push(String(err));
        }
      }
    })();

    for (let i = 0; i < 40; i++) await writeJson(target, big(i));
    stop = true;
    await reader;

    expect(reads).toBeGreaterThan(0);
    expect(parseErrors).toEqual([]);
  });
});
