import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { isHiddenContentFile, loadStackContent } from '@/lib/content-store';

let sandbox: string;
const realCwd = process.cwd();

beforeAll(() => {
  sandbox = mkdtempSync(join(tmpdir(), 'lifeos-content-'));
  const dir = join(sandbox, 'src/content/demo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'data.json'), '{"a":1}');
  writeFileSync(join(dir, 'notes.md'), '# hello');
  writeFileSync(join(dir, '.scan-lock'), 'x');       // job dot-file — hidden
  writeFileSync(join(dir, '.gitkeep'), '');           // hidden
  writeFileSync(join(dir, 'image.png'), '');          // not md/json — excluded
  process.chdir(sandbox);
});

afterAll(() => {
  process.chdir(realCwd);
  rmSync(sandbox, { recursive: true, force: true });
});

describe('the hidden-file rule (one encoding for chat dumps and agent output)', () => {
  it('dot-prefixed files are hidden', () => {
    expect(isHiddenContentFile('.scan-results.json')).toBe(true);
    expect(isHiddenContentFile('.gitkeep')).toBe(true);
    expect(isHiddenContentFile('grocery.json')).toBe(false);
  });
});

describe('loadStackContent', () => {
  it('dumps visible md/json files with headers, skipping hidden and binary files', async () => {
    const dump = await loadStackContent('demo');
    expect(dump).toContain('### data.json');
    expect(dump).toContain('### notes.md');
    expect(dump).not.toContain('.scan-lock');
    expect(dump).not.toContain('image.png');
  });

  it('reports missing stacks as empty', async () => {
    expect(await loadStackContent('nope')).toBe('(no content yet)');
  });
});
