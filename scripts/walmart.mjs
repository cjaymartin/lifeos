#!/usr/bin/env node
// ── walmart CLI — the Walmart agent's interface to on-demand cart ops ─────────
//
// Thin wrapper over the single front door (POST /api/grocery/walmart/command).
// Authenticates with the session bearer token (HMAC of SESSION_SECRET — the same
// token the browser extension uses) so a headless agent can drive Walmart from
// Bash without a session cookie. The server routes each op through the extension
// when present and the local Playwright session otherwise (ADR 0001).
//
// Usage:
//   node scripts/walmart.mjs get-cart
//   node scripts/walmart.mjs get-history
//   node scripts/walmart.mjs get-deliveries
//   node scripts/walmart.mjs add-item    --product <productId> [--qty <n>]
//   node scripts/walmart.mjs remove-item --product <productId>
//
// Env: LIFEOS_URL (default http://localhost:4321), SESSION_SECRET (else read
// from .env at the repo root).

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OPS = ['get-cart', 'get-history', 'get-deliveries', 'add-item', 'remove-item'];

function loadSessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  try {
    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
    const env = readFileSync(join(repoRoot, '.env'), 'utf-8');
    const line = env.split('\n').find((l) => l.trim().startsWith('SESSION_SECRET='));
    if (line) return line.slice(line.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '');
  } catch { /* no .env */ }
  return '';
}

function parseArgs(argv) {
  const [op, ...rest] = argv;
  const out = { op };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--product' || a === '-p') out.productId = rest[++i];
    else if (a === '--qty' || a === '-q') out.qty = Number(rest[++i]);
  }
  return out;
}

function fail(msg) {
  console.error(`walmart: ${msg}`);
  console.error(`usage: node scripts/walmart.mjs <${OPS.join('|')}> [--product <id>] [--qty <n>]`);
  process.exit(2);
}

const { op, productId, qty } = parseArgs(process.argv.slice(2));
if (!OPS.includes(op)) fail(`unknown op "${op ?? ''}"`);
if ((op === 'add-item' || op === 'remove-item') && !productId) fail(`${op} requires --product <productId>`);

const secret = loadSessionSecret();
if (!secret) fail('SESSION_SECRET not set (env or .env)');
const token = createHmac('sha256', secret).update('lifeos-session-v2').digest('hex');

const base = (process.env.LIFEOS_URL || 'http://localhost:4321').replace(/\/+$/, '');

try {
  const res = await fetch(`${base}/api/grocery/walmart/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ op, productId, qty }),
  });
  const data = await res.json().catch(() => ({}));
  console.log(JSON.stringify(data, null, 2));
  process.exit(data && data.ok ? 0 : 1);
} catch (e) {
  fail(`request failed: ${(e && e.message) || e}`);
}
