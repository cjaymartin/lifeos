import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

// Repo root is two levels up from tests/unit/.
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCKERFILE = readFileSync(join(repoRoot, 'Dockerfile'), 'utf-8');

/**
 * The instruction lines (comments + blanks stripped) of a named multi-stage
 * build stage — `FROM … AS <name>` up to the next `FROM`. We strip `#` lines so
 * assertions match real RUN instructions, not prose in the explanatory comments.
 */
function stageInstructions(name: string): string {
  const lines = DOCKERFILE.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^FROM\\s+.+\\sAS\\s+${name}\\b`).test(l));
  if (start === -1) throw new Error(`Dockerfile stage "${name}" not found`);
  const rest = lines.slice(start + 1);
  const endRel = rest.findIndex((l) => /^FROM\s/.test(l));
  const body = endRel === -1 ? rest : rest.slice(0, endRel);
  return body
    .filter((l) => !l.trim().startsWith('#') && l.trim() !== '')
    .join('\n');
}

describe('Dockerfile — Playwright browser install (NIM-1)', () => {
  const watch = stageInstructions('watch');

  it('exposes the named stages the deployment relies on', () => {
    // `watch` is the default/live stage (CMD nodemon); `runtime` is the pinned image.
    expect(() => stageInstructions('watch')).not.toThrow();
    expect(() => stageInstructions('runtime')).not.toThrow();
  });

  it('the watch (default/live) stage downloads a Playwright Chromium browser', () => {
    // launchProfile() (browser-session.ts) tries channel:'chrome' then falls back
    // to Playwright's bundled Chromium. If no browser is baked into the image the
    // fallback throws "Executable doesn't exist …/chrome-headless-shell" and every
    // Settings → Logins verify/relogin dies on the live instance — the NIM-1 bug.
    expect(watch).toMatch(/playwright[\s\S]*\binstall\b[\s\S]*chromium/);
  });

  it('installs via the runtime playwright CLI directly, not npx / .bin/playwright', () => {
    // `npx playwright` and node_modules/.bin/playwright both resolve to the
    // @playwright/test DEV dependency, which `npm ci --omit=dev` in this stage does
    // not install — that path fails the build with "playwright: not found" (exit
    // 127). The runtime `playwright` package ships its own CLI at cli.js; invoke it
    // directly so the install survives the production (--omit=dev) dependency set.
    expect(watch).toContain('node node_modules/playwright/cli.js install chromium');
    expect(watch).not.toMatch(/\bnpx\s+playwright\s+install\b/);
  });
});
