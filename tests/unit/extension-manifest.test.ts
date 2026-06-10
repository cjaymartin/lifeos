import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(join(repo, 'extension/lifeos/manifest.json'), 'utf-8'));

describe('extension manifest (cross-browser MV3)', () => {
  it('declares BOTH background keys so it loads in Chrome and Firefox', () => {
    // Chrome MV3 uses service_worker; Firefox MV3 uses scripts (event page).
    // Missing the latter is exactly the "background.service_worker is disabled"
    // Firefox install error.
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe('background.js');
    expect(manifest.background.scripts).toContain('background.js');
  });

  it('announces presence on LifeOS pages (for install detection)', () => {
    const announce = (manifest.content_scripts ?? []).find((c: any) => (c.js ?? []).includes('announce.js'));
    expect(announce).toBeTruthy();
    expect(announce.matches.some((m: string) => m.includes('localhost'))).toBe(true);
  });
});
