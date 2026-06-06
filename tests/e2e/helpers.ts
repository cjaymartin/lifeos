import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const repo = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Path inside the sandboxed content copy the test server is running against. */
export function sandboxPath(...parts: string[]): string {
  return join(repo, '.test-sandbox', ...parts);
}

/** Read a JSON file from the sandboxed content store. */
export function readSandboxJson<T = any>(relative: string): T {
  return JSON.parse(readFileSync(sandboxPath(relative), 'utf-8'));
}
