// ── Account verification + re-login runner ───────────────────────────────────
//
// Same lock-file pattern as the populate-* runners: one lock per account at
// src/content/settings/.job-<id>-lock, stale after 5 min. Jobs run async in
// the server process (Playwright) or as a spawned headless claude (MCP
// probes), and write their outcome to status.json for the UI to poll.

import { spawn } from 'child_process';
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { createWriteStream } from 'fs';
import { join, dirname } from 'path';
import { getAccount, type AccountDef } from './accounts';
import { getAccountSecrets } from './secrets';
import { setAccountStatus } from './status';
import { checkLoginState, autoRelogin } from './browser-session';
import type { AccountId } from './settings-types';

const SETTINGS_DIR = join(process.cwd(), 'src/content/settings');
const STALE_MS = 5 * 60 * 1000;

function lockPath(id: string) {
  return join(SETTINGS_DIR, `.job-${id}-lock`);
}

export async function jobRunning(id: string): Promise<boolean> {
  try {
    const ts = Number(await readFile(lockPath(id), 'utf-8'));
    return Date.now() - ts < STALE_MS;
  } catch {
    return false;
  }
}

async function acquireLock(id: string): Promise<boolean> {
  if (await jobRunning(id)) return false;
  await mkdir(SETTINGS_DIR, { recursive: true });
  await writeFile(lockPath(id), String(Date.now()));
  return true;
}

async function releaseLock(id: string) {
  try {
    await unlink(lockPath(id));
  } catch {}
}

// ── per-kind verifiers ───────────────────────────────────────────────────────

/** mcp-probe: headless claude with exactly one allowed tool; parse PROBE_OK. */
function runMcpProbe(account: AccountDef): void {
  const logPath = join(SETTINGS_DIR, `.probe-${account.id}.log`);
  const out = createWriteStream(logPath);
  const proc = spawn(
    'claude',
    ['-p', account.probePrompt!, '--permission-mode', 'acceptEdits', '--allowedTools', account.probeTool!],
    { cwd: process.cwd(), env: { ...process.env } },
  );
  proc.stdout.pipe(out);
  proc.stderr.pipe(out);

  proc.on('error', async (err) => {
    await setAccountStatus(account.id, 'failed', `claude spawn error: ${err.message}`);
    await releaseLock(account.id);
  });
  proc.on('exit', async (code) => {
    try {
      const log = await readFile(logPath, 'utf-8').catch(() => '');
      if (log.includes('PROBE_OK')) {
        await setAccountStatus(account.id, 'ok', 'Connector responding');
      } else {
        const fail = log.match(/PROBE_FAIL:?\s*(.+)/)?.[1]?.trim();
        await setAccountStatus(
          account.id,
          'failed',
          fail ?? `Probe gave no verdict (exit ${code}) — check ${logPath.replace(process.cwd() + '/', '')}`,
        );
      }
    } finally {
      await releaseLock(account.id);
    }
  });
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
  try {
    const token =
      getAccountSecrets(account.id).token ??
      (import.meta as any).env?.TODOIST_API_TOKEN ??
      process.env.TODOIST_API_TOKEN ??
      '';
    if (!token.trim()) {
      await setAccountStatus(account.id, 'needs-attention', 'No API token saved yet');
      return;
    }
    const { ok, detail } = await verifyTodoistToken(token.trim());
    await setAccountStatus(account.id, ok ? 'ok' : 'failed', detail);
  } finally {
    await releaseLock(account.id);
  }
}

async function runBrowserVerify(account: AccountDef): Promise<void> {
  try {
    const check = await checkLoginState(account);
    await setAccountStatus(
      account.id,
      check.loggedIn ? 'ok' : check.challenged ? 'needs-attention' : 'failed',
      check.detail,
    );
  } catch (err) {
    await setAccountStatus(account.id, 'failed', `Browser probe error: ${(err as Error).message}`);
  } finally {
    await releaseLock(account.id);
  }
}

async function runBrowserRelogin(account: AccountDef): Promise<void> {
  try {
    const result = await autoRelogin(account, getAccountSecrets(account.id));
    await setAccountStatus(
      account.id,
      result.loggedIn ? 'ok' : result.challenged ? 'needs-attention' : 'failed',
      result.detail,
    );
  } catch (err) {
    await setAccountStatus(account.id, 'failed', `Re-login error: ${(err as Error).message}`);
  } finally {
    await releaseLock(account.id);
  }
}

// ── public API (fire-and-forget, lock-guarded) ───────────────────────────────

export async function spawnVerify(id: AccountId): Promise<'started' | 'running' | 'unknown'> {
  const account = getAccount(id);
  if (!account) return 'unknown';
  if (!(await acquireLock(id))) return 'running';

  if (account.kind === 'mcp-probe') runMcpProbe(account);
  else if (account.kind === 'api-token') void runApiTokenVerify(account);
  else void runBrowserVerify(account);

  return 'started';
}

export async function spawnRelogin(id: AccountId): Promise<'started' | 'running' | 'unknown'> {
  const account = getAccount(id);
  if (!account || account.kind !== 'browser-session') return 'unknown';
  if (!(await acquireLock(id))) return 'running';
  void runBrowserRelogin(account);
  return 'started';
}
