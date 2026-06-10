import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ops resolves its content dir from process.cwd() at import time — chdir into a
// sandbox BEFORE the dynamic import below.
const sandbox = mkdtempSync(join(tmpdir(), 'lifeos-grocery-cat-'));
const DIR = join(sandbox, 'src/content/grocery');
mkdirSync(DIR, { recursive: true });
const realCwd = process.cwd();
process.chdir(sandbox);

const grocery = await import('@/features/grocery/ops');

afterAll(() => {
  process.chdir(realCwd);
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

beforeEach(() => {
  rm('category-map.json');
  rm('.categories-migrated');
  writeJson('staples.json', { staples: [] });
  writeJson('grocery.json', { lastUpdated: '', items: [] });
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
    writeJson('staples.json', { staples: [
      { id: 'a', name: 'fairlife 2% milk', category: 'Other', status: 'stocked' },
      { id: 'b', name: 'paper plates', category: 'Other', status: 'stocked' },
      { id: 'c', name: 'dog food', category: 'Other', status: 'stocked' },
    ] });

    await grocery.loadGroceryState();
    let staples = readJson('staples.json').staples;
    expect(staples.find((x: any) => x.id === 'a').category).toBe('Dairy & Eggs');
    expect(staples.find((x: any) => x.id === 'b').category).toBe('Household');
    expect(staples.find((x: any) => x.id === 'c').category).toBe('Other'); // uncategorizable
    expect(existsSync(join(DIR, '.categories-migrated'))).toBe(true);

    // Idempotent: a deliberate later "Other" must NOT be re-filed on the next load
    staples = readJson('staples.json').staples;
    staples.find((x: any) => x.id === 'a').category = 'Other';
    writeJson('staples.json', { staples });
    await grocery.loadGroceryState();
    expect(readJson('staples.json').staples.find((x: any) => x.id === 'a').category).toBe('Other');
  });
});
