import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load as yamlLoad } from 'js-yaml';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Path inside the sandboxed content copy the test server is running against. */
export function sandboxPath(...parts: string[]): string {
  return join(repo, '.test-sandbox', ...parts);
}

/** Path inside the sandboxed vault (human Markdown content). */
export function sandboxVaultPath(...parts: string[]): string {
  return join(repo, '.test-sandbox', 'vault', ...parts);
}

/** Read a JSON file from the sandboxed content store. */
export function readSandboxJson<T = any>(relative: string): T {
  return JSON.parse(readFileSync(sandboxPath(relative), 'utf-8'));
}

/** Read a single sandbox-vault note's frontmatter (empty object if missing). */
export function readSandboxVaultNote<T = any>(relativePath: string): T {
  try {
    const raw = readFileSync(sandboxVaultPath(relativePath), 'utf-8');
    const m = raw.match(/^---\n([\s\S]*?)\n---/);
    return (m ? yamlLoad(m[1]) : {}) as T;
  } catch {
    return {} as T;
  }
}

/** Read every visible *.md note's frontmatter from a sandbox-vault directory. */
export function readSandboxVaultNotes<T = any>(relativeDir: string): T[] {
  const dir = sandboxVaultPath(relativeDir);
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

/** Seed/overwrite a JSON file in the sandboxed content store. */
export function writeSandboxJson(relative: string, data: unknown): void {
  writeFileSync(sandboxPath(relative), JSON.stringify(data, null, 2));
}
