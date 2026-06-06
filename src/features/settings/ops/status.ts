// ── Verification status store — src/content/settings/status.json ────────────
// Not secret (states + timestamps only), tracked in git like other content.

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import type { AccountId, AccountStatus, SettingsStatusFile, VerifyState } from './settings-types';

export const STATUS_FILE = join(process.cwd(), 'src/content/settings/status.json');

export async function loadStatus(): Promise<SettingsStatusFile> {
  try {
    return JSON.parse(await readFile(STATUS_FILE, 'utf-8'));
  } catch {
    return { accounts: {} };
  }
}

export async function setAccountStatus(
  id: AccountId,
  state: VerifyState,
  detail?: string,
): Promise<AccountStatus> {
  const status = await loadStatus();
  const entry: AccountStatus = { state, checkedAt: Date.now(), ...(detail ? { detail } : {}) };
  status.accounts[id] = entry;
  await mkdir(dirname(STATUS_FILE), { recursive: true });
  await writeFile(STATUS_FILE, JSON.stringify(status, null, 2) + '\n');
  return entry;
}
