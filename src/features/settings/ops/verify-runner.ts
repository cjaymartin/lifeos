// ── Account verification + re-login runner ───────────────────────────────────
//
// One lock per account (src/content/settings/.job-<id>-lock) via the agent-job
// runner module. Jobs run async in the server process (Playwright) or as a
// captured headless claude (MCP probes), and write their outcome to
// status.json for the UI to poll.

import { mkdir } from 'fs/promises';
import { join } from 'path';
import { defineJobLock, isLockFresh, startLockedTask, runAgentCapture } from '@/lib/jobs/runner';
import { getAccount, type AccountDef } from './accounts';
import { getAccountSecrets } from './secrets';
import { setAccountStatus } from './status';
import { checkLoginState, autoRelogin, type SessionCheck } from './browser-session';
import type { AccountId, VerifyState } from './settings-types';

const SETTINGS_DIR = join(process.cwd(), 'src/content/settings');

const accountLock = (id: string) => defineJobLock(join(SETTINGS_DIR, `.job-${id}-lock`));

export function jobRunning(id: string): Promise<boolean> {
  return isLockFresh(accountLock(id));
}

/** The one SessionCheck → VerifyState translation (was inlined per caller). */
function stateFromCheck(check: SessionCheck): VerifyState {
  return check.loggedIn ? 'ok' : check.challenged ? 'needs-attention' : 'failed';
}

// ── per-kind verifiers ───────────────────────────────────────────────────────

/** mcp-probe: headless claude with exactly one allowed tool; parse PROBE_OK. */
async function runMcpProbe(account: AccountDef): Promise<void> {
  const logPath = join(SETTINGS_DIR, `.probe-${account.id}.log`);
  try {
    const out = await runAgentCapture({
      prompt: account.probePrompt!,
      allowedTools: [account.probeTool!],
      extraArgs: ['--permission-mode', 'acceptEdits'],
      logPath,
    });
    if (out.includes('PROBE_OK')) {
      await setAccountStatus(account.id, 'ok', 'Connector responding');
    } else {
      const fail = out.match(/PROBE_FAIL:?\s*(.+)/)?.[1]?.trim();
      await setAccountStatus(
        account.id,
        'failed',
        fail ?? `Probe gave no verdict — check ${logPath.replace(process.cwd() + '/', '')}`,
      );
    }
  } catch (err) {
    await setAccountStatus(account.id, 'failed', `claude probe error: ${(err as Error).message}`);
  }
}

/** api-token: direct REST check. Exported so the token-save route can reuse it. */
export async function verifyTodoistToken(token: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch('https://api.todoist.com/api/v1/user', {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, detail: `Todoist rejected the token (HTTP ${res.status})` };
    const user = (await res.json()) as { email?: string; full_name?: string };
    return { ok: true, detail: `Token valid — ${user.full_name ?? user.email ?? 'account'} ` };
  } catch (err) {
    return { ok: false, detail: `Todoist API unreachable: ${(err as Error).message}` };
  }
}

async function runApiTokenVerify(account: AccountDef): Promise<void> {
  // process.env ONLY — never import.meta.env (baked into dist/ at build, NIM-7).
  const token = getAccountSecrets(account.id).token ?? process.env.TODOIST_API_TOKEN ?? '';
  if (!token.trim()) {
    await setAccountStatus(account.id, 'needs-attention', 'No API token saved yet');
    return;
  }
  const { ok, detail } = await verifyTodoistToken(token.trim());
  await setAccountStatus(account.id, ok ? 'ok' : 'failed', detail);
}

async function runBrowserVerify(account: AccountDef): Promise<void> {
  try {
    const check = await checkLoginState(account);
    await setAccountStatus(account.id, stateFromCheck(check), check.detail);
  } catch (err) {
    await setAccountStatus(account.id, 'failed', `Browser probe error: ${(err as Error).message}`);
  }
}

async function runBrowserRelogin(account: AccountDef): Promise<void> {
  try {
    const result = await autoRelogin(account, getAccountSecrets(account.id));
    await setAccountStatus(account.id, stateFromCheck(result), result.detail);
  } catch (err) {
    await setAccountStatus(account.id, 'failed', `Re-login error: ${(err as Error).message}`);
  }
}

// ── public API (fire-and-forget, lock-guarded) ───────────────────────────────

export async function spawnVerify(id: AccountId): Promise<'started' | 'running' | 'unknown'> {
  const account = getAccount(id);
  if (!account) return 'unknown';
  await mkdir(SETTINGS_DIR, { recursive: true });

  const run =
    account.kind === 'mcp-probe' ? () => runMcpProbe(account)
    : account.kind === 'api-token' ? () => runApiTokenVerify(account)
    : () => runBrowserVerify(account);

  return startLockedTask(accountLock(id), run);
}

export async function spawnRelogin(id: AccountId): Promise<'started' | 'running' | 'unknown'> {
  const account = getAccount(id);
  if (!account || account.kind !== 'browser-session') return 'unknown';
  await mkdir(SETTINGS_DIR, { recursive: true });
  return startLockedTask(accountLock(id), () => runBrowserRelogin(account));
}
