// Assemble the non-secret view of every account for the UI / API.

import { ACCOUNTS } from './accounts';
import { loadStatus } from './status';
import { getAccountSecrets, secretsKeyConfigured } from './secrets';
import { jobRunning } from './verify-runner';
import { hasProfile } from './browser-session';
import type { AccountInfo } from './settings-types';

export interface SettingsSnapshot {
  secretsKeyConfigured: boolean;
  accounts: AccountInfo[];
}

export async function loadSettingsSnapshot(): Promise<SettingsSnapshot> {
  const status = await loadStatus();
  const accounts = await Promise.all(
    ACCOUNTS.map(async (a): Promise<AccountInfo> => {
      let secrets: { token?: string; username?: string; password?: string } = {};
      try {
        secrets = getAccountSecrets(a.id);
      } catch {}
      return {
        id: a.id,
        label: a.label,
        icon: a.icon,
        kind: a.kind,
        description: a.description,
        repairUrl: a.repairUrl,
        repairLabel: a.repairLabel,
        status: status.accounts[a.id] ?? { state: 'unverified', checkedAt: null },
        running: await jobRunning(a.id),
        hasToken: Boolean(secrets.token),
        hasCredentials: Boolean(secrets.username && secrets.password),
        hasProfile: a.kind === 'browser-session' && hasProfile(a.id),
      };
    }),
  );
  return { secretsKeyConfigured: secretsKeyConfigured(), accounts };
}
