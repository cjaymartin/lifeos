// ── Persistent retailer browser sessions (Playwright + real Chrome) ─────────
//
// Tier 0: each retailer gets a persistent Chrome profile under
//         src/content/settings/.profiles/<id>/ (gitignored, volume-mounted).
//         Agents and probes reuse it, so to the retailer we look like the
//         same returning browser every time.
// Tier 1: autoRelogin() — scripted login with stored credentials. Escalates
//         (never pushes through) when a CAPTCHA/2FA wall appears.
// Tier 3: importCookies() — cookies pasted from any logged-in device.
//
// Tier 2 (client-side deep-link cart handoff) lives in the grocery stack and
// needs no server session at all.

import { mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { BrowserContext } from 'playwright';
import type { AccountDef } from './accounts';
import type { AccountSecrets } from './settings-types';

export const PROFILES_DIR = join(process.cwd(), 'src/content/settings/.profiles');

export function profileDir(id: string): string {
  return join(PROFILES_DIR, id);
}

export function hasProfile(id: string): boolean {
  return existsSync(join(profileDir(id), 'Default'));
}

const NAV_TIMEOUT = 45_000;

async function launchProfile(id: string): Promise<BrowserContext> {
  const { chromium } = await import('playwright');
  const dir = profileDir(id);
  mkdirSync(dir, { recursive: true });
  const opts = {
    headless: true,
    viewport: { width: 1366, height: 900 },
    // keep the "Chrome is being controlled" automation tells out of the DOM
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  };
  try {
    // real Chrome first — markedly better against retail bot checks
    return await chromium.launchPersistentContext(dir, { ...opts, channel: 'chrome' });
  } catch {
    // fall back to bundled Chromium (e.g. Chrome not installed yet)
    return await chromium.launchPersistentContext(dir, opts);
  }
}

export interface SessionCheck {
  loggedIn: boolean;
  detail: string;
  challenged?: boolean;
}

function pageHasChallenge(html: string, markers: string[] = []): boolean {
  return markers.some((m) =>
    m.startsWith('#') || m.startsWith('.') ? html.includes(m.slice(1)) : html.includes(m),
  );
}

/** Tier-0 probe: is the persistent profile still signed in? */
export async function checkLoginState(account: AccountDef): Promise<SessionCheck> {
  if (!account.accountUrl || !account.signedOutUrlMarker)
    throw new Error(`${account.id} is not a browser-session account`);

  const ctx = await launchProfile(account.id);
  try {
    const page = await ctx.newPage();
    await page.goto(account.accountUrl, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500); // let client-side auth redirects settle
    const url = page.url();
    const html = await page.content();

    if (pageHasChallenge(html, account.challengeMarkers))
      return { loggedIn: false, challenged: true, detail: 'Bot-check/2FA wall on account page — use cookie import' };
    if (url.includes(account.signedOutUrlMarker))
      return { loggedIn: false, detail: 'Session expired — signed out' };
    if ((account.signedOutTextMarkers ?? []).some((m) => html.includes(m)))
      return { loggedIn: false, detail: 'Session expired — signed out' };
    return { loggedIn: true, detail: `Session active (${new URL(url).hostname})` };
  } finally {
    await ctx.close();
  }
}

/** Tier 1: scripted re-login with stored credentials. */
export async function autoRelogin(account: AccountDef, secrets: AccountSecrets): Promise<SessionCheck> {
  if (!account.loginUrl || !account.loginFlow)
    throw new Error(`${account.id} has no login flow configured`);
  if (!secrets.username || !secrets.password)
    return { loggedIn: false, detail: 'No stored credentials — save them first or paste cookies' };

  const ctx = await launchProfile(account.id);
  try {
    const page = await ctx.newPage();
    await page.goto(account.loginUrl, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });

    for (const step of account.loginFlow) {
      await page.waitForTimeout(800 + Math.floor(Math.random() * 700)); // human-ish pacing
      if (pageHasChallenge(await page.content(), account.challengeMarkers))
        return { loggedIn: false, challenged: true, detail: 'CAPTCHA/2FA encountered — paste cookies from a logged-in device instead' };

      if (step.fill) {
        const value = step.secret === 'password' ? secrets.password : secrets.username;
        const field = page.locator(step.fill).first();
        // fields can be skipped when the site remembers the email — don't fail on absence
        if (await field.isVisible({ timeout: 5000 }).catch(() => false))
          await field.fill(value, { timeout: 10_000 });
      }
      if (step.click) {
        const btn = page.locator(step.click).first();
        if (await btn.isVisible({ timeout: 5000 }).catch(() => false)) {
          await Promise.all([
            page.waitForLoadState('domcontentloaded', { timeout: NAV_TIMEOUT }).catch(() => {}),
            btn.click({ timeout: 10_000 }),
          ]);
        }
      }
    }

    await page.waitForTimeout(3000);
    if (pageHasChallenge(await page.content(), account.challengeMarkers))
      return { loggedIn: false, challenged: true, detail: 'CAPTCHA/2FA after submit — paste cookies from a logged-in device instead' };
  } finally {
    await ctx.close();
  }

  // fresh context: confirm the session actually took
  const check = await checkLoginState(account);
  return check.loggedIn
    ? { loggedIn: true, detail: 'Re-login succeeded — session refreshed' }
    : { ...check, detail: `Re-login did not stick: ${check.detail}` };
}

// ── Tier 3: cookie import ────────────────────────────────────────────────────

interface RawCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  expirationDate?: number; // Cookie-Editor / EditThisCookie export field
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

function normalizeSameSite(v: string | undefined): 'Strict' | 'Lax' | 'None' {
  const s = (v ?? '').toLowerCase();
  if (s === 'strict') return 'Strict';
  if (s === 'no_restriction' || s === 'none') return 'None';
  return 'Lax';
}

/** Accepts a JSON array as exported by Cookie-Editor / EditThisCookie / devtools. */
export async function importCookies(account: AccountDef, cookiesJson: string): Promise<SessionCheck> {
  let raw: RawCookie[];
  try {
    const parsed = JSON.parse(cookiesJson);
    raw = Array.isArray(parsed) ? parsed : parsed.cookies; // some exporters wrap in {cookies:[...]}
    if (!Array.isArray(raw)) throw new Error('not an array');
  } catch {
    return { loggedIn: false, detail: 'Could not parse cookie JSON — export as a JSON array (e.g. Cookie-Editor → Export → JSON)' };
  }

  const cookies = raw
    .filter((c) => c.name && c.value !== undefined)
    .map((c) => ({
      name: c.name,
      value: String(c.value),
      domain: c.domain ?? new URL(account.accountUrl!).hostname.replace(/^www\./, '.'),
      path: c.path ?? '/',
      expires: c.expirationDate ?? c.expires ?? -1,
      httpOnly: c.httpOnly ?? false,
      secure: c.secure ?? true,
      sameSite: normalizeSameSite(c.sameSite),
    }));

  if (cookies.length === 0) return { loggedIn: false, detail: 'No cookies found in the pasted JSON' };

  const ctx = await launchProfile(account.id);
  try {
    await ctx.addCookies(cookies);
  } finally {
    await ctx.close();
  }

  const check = await checkLoginState(account);
  return check.loggedIn
    ? { loggedIn: true, detail: `Imported ${cookies.length} cookies — session verified` }
    : { ...check, detail: `Imported ${cookies.length} cookies but still signed out: ${check.detail}` };
}
