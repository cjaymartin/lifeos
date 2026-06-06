// QA: API robustness — see tests/qa/cases/api.md
// Malformed payloads and unknown ids should produce 4xx, never 5xx.
import { startQA, BASE } from './qa-lib.mjs';

const qa = await startQA('api');
const ORIGIN = { origin: BASE };

await qa.check('API-1', 'unknown page path returns 404, not a crash', async (page) => {
  const res = await page.goto(BASE + '/definitely-not-a-page');
  if (res.status() !== 404) throw new Error(`→ ${res.status()}`);
});

await qa.check('API-2', 'malformed JSON bodies are 4xx, not 5xx', async () => {
  for (const path of ['/api/grocery', '/api/grocery/staples', '/api/deliveries/dismiss', '/api/tasks']) {
    const res = await qa.context.request.post(BASE + path, {
      headers: { 'content-type': 'application/json', ...ORIGIN },
      data: '{not json',
    });
    if (res.status() >= 500) throw new Error(`${path} → ${res.status()}`);
  }
});

await qa.check('API-3', 'unknown resource ids are 4xx, not 5xx', async () => {
  const probes = [
    ['/api/grocery/items/does-not-exist', 'PATCH', { name: 'x' }],
    ['/api/grocery/items/does-not-exist', 'DELETE', undefined],
    ['/api/tasks/does-not-exist', 'PATCH', { content: 'x' }],
    ['/api/tasks/does-not-exist/complete', 'POST', {}],
    ['/api/deliveries/dismiss', 'POST', { id: 'does-not-exist' }],
    ['/api/deliveries/restore', 'POST', { id: 'does-not-exist' }],
  ];
  const failures = [];
  for (const [path, method, data] of probes) {
    const res = await qa.api(path, { method, data, headers: ORIGIN });
    if (res.status() >= 500) failures.push(`${method} ${path} → ${res.status()}`);
  }
  if (failures.length) throw new Error(failures.join(' | '));
});

await qa.check('API-4', 'empty-body POSTs to JSON endpoints are 4xx, not 5xx', async () => {
  const failures = [];
  for (const path of ['/api/grocery', '/api/grocery/carts', '/api/grocery/checkout', '/api/settings/cookies']) {
    const res = await qa.context.request.post(BASE + path, {
      headers: { 'content-type': 'application/json', ...ORIGIN },
    });
    if (res.status() >= 500) failures.push(`${path} → ${res.status()}`);
  }
  if (failures.length) throw new Error(failures.join(' | '));
});

await qa.check('API-5', 'grocery GET returns the full state shape', async () => {
  const res = await qa.api('/api/grocery');
  if (!res.ok()) throw new Error(`→ ${res.status()}`);
  const body = await res.json();
  for (const key of ['items', 'staples']) {
    if (!(key in body)) throw new Error(`missing ${key} in /api/grocery response`);
  }
});

await qa.check('API-6', 'job status endpoints respond with run state', async () => {
  for (const path of ['/api/refresh/status', '/api/deliveries/status', '/api/grocery/status']) {
    const res = await qa.api(path);
    if (!res.ok()) throw new Error(`${path} → ${res.status()}`);
  }
});

await qa.check('API-7', 'tasks GET returns the mirror snapshot', async () => {
  const res = await qa.api('/api/tasks');
  if (!res.ok()) throw new Error(`→ ${res.status()}`);
  const body = await res.json();
  if (!Array.isArray(body.tasks)) throw new Error('no tasks array');
});

await qa.check('API-8', 'completed tasks endpoint responds', async () => {
  const res = await qa.api('/api/tasks/completed');
  if (!res.ok()) throw new Error(`→ ${res.status()}`);
});

await qa.finish();
