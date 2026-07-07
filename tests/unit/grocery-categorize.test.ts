import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { dump as yamlDump, load as yamlLoad } from 'js-yaml';

// ops resolves its machine store from process.cwd() at import time — chdir into
// a sandbox BEFORE the dynamic import below. The grocery list + staples migrated
// into the vault, so also point LIFEOS_VAULT_DIR at a throwaway vault.
const sandbox = mkdtempSync(join(tmpdir(), 'lifeos-grocery-cat-'));
const DIR = join(sandbox, 'src/content/grocery');
mkdirSync(DIR, { recursive: true });
const VAULT = join(sandbox, 'vault');
const GROCERY_DIR = join(VAULT, 'grocery', 'list');
const STAPLES_DIR = join(VAULT, 'grocery', 'staples');
process.env.LIFEOS_VAULT_DIR = VAULT;
const realCwd = process.cwd();
process.chdir(sandbox);

const grocery = await import('@/features/grocery/ops');

afterAll(() => {
  process.chdir(realCwd);
  delete process.env.LIFEOS_VAULT_DIR;
  rmSync(sandbox, { recursive: true, force: true });
});

function writeJson(file: string, data: unknown) {
  writeFileSync(join(DIR, file), JSON.stringify(data, null, 2));
}
function readJson<T = any>(file: string): T {
  return JSON.parse(readFileSync(join(DIR, file), 'utf-8'));
}
function rm(file: string) {
  rmSync(join(DIR, file), { force: true });
}

// ── Vault helpers (grocery list + staples are one Markdown note per item) ─────
function writeNotes(dir: string, items: Array<Record<string, any>>) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const it of items) {
    writeFileSync(join(dir, `${it.id}.md`), `---\n${yamlDump(it)}---\n`);
  }
}
function readNotes<T = any>(dir: string): T[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && !f.startsWith('.'));
  } catch {
    return [];
  }
  return files.map((f) => {
    const raw = readFileSync(join(dir, f), 'utf-8');
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    return (m ? yamlLoad(m[1]) : {}) as T;
  });
}
function writeStaples(staples: Array<Record<string, any>>) {
  writeNotes(STAPLES_DIR, staples);
}
function readStaples<T = any>(): T[] {
  return readNotes<T>(STAPLES_DIR);
}

beforeEach(() => {
  rm('category-map.json');
  rm('.categories-migrated');
  writeStaples([]);
  writeNotes(GROCERY_DIR, []);
});

describe('resolveCategory', () => {
  it('expanded keywords place the known "Other" misses', () => {
    expect(grocery.resolveCategory('paper plates', {})[0]).toBe('Household');
    expect(grocery.resolveCategory('paper bowls', {})[0]).toBe('Household');
    expect(grocery.resolveCategory('psyllium fiber', {})[0]).toBe('Personal Care');
    expect(grocery.resolveCategory('Ibuprofin', {})[0]).toBe('Personal Care'); // misspelling too
  });

  it('a learned override wins over the heuristic and is confirmed', () => {
    const [cat, confirmed] = grocery.resolveCategory('milk', { milk: 'Beverages' });
    expect(cat).toBe('Beverages');
    expect(confirmed).toBe(true);
  });

  it('an invalid learned value is ignored, falling back to the heuristic', () => {
    expect(grocery.resolveCategory('milk', { milk: 'Nonsense' })[0]).toBe('Dairy & Eggs');
  });

  it('genuinely unknown items fall through to Other (unconfirmed)', () => {
    expect(grocery.resolveCategory('flux capacitor', {})).toEqual(['Other', false]);
  });
});

describe('learnCategory', () => {
  it('persists a decision keyed by normalized name', async () => {
    await grocery.learnCategory('Dragon Fruit', 'Produce');
    expect(readJson('category-map.json')['dragon fruit']).toBe('Produce');
  });

  it('ignores categories outside the known set', async () => {
    await grocery.learnCategory('thing', 'NotACategory');
    expect(existsSync(join(DIR, 'category-map.json'))).toBe(false);
  });
});

describe('migrateStapleCategories (via loadGroceryState)', () => {
  it('re-files Other staples once and is idempotent', async () => {
    writeStaples([
      { id: 'a', name: 'fairlife 2% milk', category: 'Other', status: 'stocked' },
      { id: 'b', name: 'paper plates', category: 'Other', status: 'stocked' },
      { id: 'c', name: 'dog food', category: 'Other', status: 'stocked' },
    ]);

    await grocery.loadGroceryState();
    let staples = readStaples();
    expect(staples.find((x: any) => x.id === 'a').category).toBe('Dairy & Eggs');
    expect(staples.find((x: any) => x.id === 'b').category).toBe('Household');
    expect(staples.find((x: any) => x.id === 'c').category).toBe('Other'); // uncategorizable
    expect(existsSync(join(DIR, '.categories-migrated'))).toBe(true);

    // Idempotent: a deliberate later "Other" must NOT be re-filed on the next load
    staples = readStaples();
    staples.find((x: any) => x.id === 'a').category = 'Other';
    writeStaples(staples);
    await grocery.loadGroceryState();
    expect(readStaples().find((x: any) => x.id === 'a').category).toBe('Other');
  });
});
