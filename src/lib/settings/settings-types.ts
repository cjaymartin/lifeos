// ── Settings > Logins & Sessions — shared types ──────────────────────────────

/** How LifeOS authenticates to this account. */
export type AccountKind =
  | 'mcp-probe' // OAuth lives on claude.ai; we can only verify via a spawned claude probe
  | 'api-token' // direct REST token stored in the encrypted secrets store
  | 'browser-session'; // persistent Chrome profile driven by Playwright

export type AccountId = 'gmail' | 'gcal' | 'todoist' | 'walmart' | 'amazon';

export type VerifyState = 'ok' | 'failed' | 'needs-attention' | 'unverified';

export interface AccountStatus {
  state: VerifyState;
  /** epoch ms of the last completed verification (any outcome) */
  checkedAt: number | null;
  /** human-readable result, e.g. "Signed in as C.Jay" or the failure reason */
  detail?: string;
}

/** src/content/settings/status.json */
export interface SettingsStatusFile {
  accounts: Partial<Record<AccountId, AccountStatus>>;
}

/** Decrypted shape of the secrets store. All fields optional per account. */
export interface AccountSecrets {
  token?: string; // api-token accounts
  username?: string; // browser-session auto re-login
  password?: string;
}

export type SecretsFile = Partial<Record<AccountId, AccountSecrets>>;

/** One step of a scripted retailer login (auto re-login ladder, tier 1). */
export interface LoginStep {
  /** CSS selector to fill; value comes from the named secret */
  fill?: string;
  secret?: 'username' | 'password';
  /** CSS selector to click after optional fill */
  click?: string;
}

/** What the API returns to the UI for each account (no secret values). */
export interface AccountInfo {
  id: AccountId;
  label: string;
  icon: string; // lucide icon name
  kind: AccountKind;
  description: string;
  /** where to fix a broken connection that we can't repair in-app */
  repairUrl?: string;
  repairLabel?: string;
  status: AccountStatus;
  running: boolean; // a verify/re-login job is in flight
  hasToken: boolean;
  hasCredentials: boolean;
  hasProfile: boolean; // a Chrome profile dir exists for this retailer
}
