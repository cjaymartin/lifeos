// LifeOS background service worker.
//
// Two jobs:
//   1. PUSH (existing): receive scraped order-history / cart from the content
//      scripts and POST them to LifeOS with the bearer (session) token.
//   2. PULL (new, ADR 0001): long-poll LifeOS for on-demand Walmart commands
//      (get cart/history/deliveries, add/remove an item), execute each in a
//      Walmart tab in the user's own logged-in session, and POST the result.
//
// All network egress lives here, where the user-granted host permission is.

const api = globalThis.browser ?? globalThis.chrome;
const WALMART = 'https://www.walmart.com';

async function getConfig() {
  const { lifeosUrl, token } = await api.storage.local.get(['lifeosUrl', 'token']);
  return { lifeosUrl, token };
}

async function flash(text, ms = 4000) {
  try {
    await api.action.setBadgeText({ text });
    if (text) setTimeout(() => api.action.setBadgeText({ text: '' }), ms);
  } catch { /* action API may be unavailable in some contexts */ }
}

// Bearer-authenticated call to LifeOS. Throws on missing config / non-2xx.
async function lifeos(path, opts = {}) {
  const { lifeosUrl, token } = await getConfig();
  if (!lifeosUrl || !token) throw new Error('not-configured');
  const url = lifeosUrl.replace(/\/+$/, '') + path;
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

/* ── PUSH: content-script syncs ─────────────────────────────────────────── */

async function post(path, body) {
  try {
    await lifeos(path, { method: 'POST', body: JSON.stringify(body) });
    flash('OK');
  } catch (e) {
    if (e.message === 'not-configured') { flash('SET'); return; }
    console.error(`[LifeOS] ${path} failed`, e);
    flash('ERR');
  }
}

api.runtime.onMessage.addListener((msg) => {
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'lifeos-order-history' && Array.isArray(msg.products) && msg.products.length) {
    post('/api/grocery/order-history', { retailer: msg.retailer || 'walmart', products: msg.products });
  } else if (msg.type === 'lifeos-cart' && Array.isArray(msg.items)) {
    post('/api/grocery/carts/observed', { retailer: msg.retailer || 'walmart', items: msg.items });
  }
});

/* ── PULL: on-demand Walmart commands ───────────────────────────────────── */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A walmart.com tab to act in — reuse an open one, else open a background tab.
async function getWalmartTab() {
  const tabs = await api.tabs.query({ url: `${WALMART}/*` });
  if (tabs && tabs.length) return tabs[0];
  return api.tabs.create({ url: `${WALMART}/`, active: false });
}

function waitForTabComplete(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('tab load timeout')); }, timeoutMs);
    function listener(id, info) { if (id === tabId && info.status === 'complete') { cleanup(); resolve(); } }
    function cleanup() { clearTimeout(timer); api.tabs.onUpdated.removeListener(listener); }
    api.tabs.onUpdated.addListener(listener);
  });
}

async function navigate(tabId, url) {
  await api.tabs.update(tabId, { url });
  await waitForTabComplete(tabId);
  await sleep(1500); // let client-side render settle before scraping
}

// Message the content script, retrying while it finishes injecting after a nav.
async function askTab(tabId, msg, retries = 6) {
  for (let i = 0; i <= retries; i++) {
    try { return await api.tabs.sendMessage(tabId, msg); }
    catch (e) { if (i === retries) throw e; await sleep(700); }
  }
}

async function executeCommand(cmd) {
  const tab = await getWalmartTab();
  const tabId = tab.id;
  const action = (a, extra) => askTab(tabId, { type: 'lifeos-walmart-action', action: a, ...extra });

  switch (cmd.op) {
    case 'get-cart':
      await navigate(tabId, `${WALMART}/cart`);
      return action('scrape-cart');
    case 'get-history':
      await navigate(tabId, `${WALMART}/orders`);
      return action('scrape-history');
    case 'get-deliveries':
      await navigate(tabId, `${WALMART}/orders`);
      return action('scrape-deliveries');
    case 'add-item': {
      const items = (cmd.params.items && cmd.params.items.length)
        ? cmd.params.items
        : [{ productId: cmd.params.productId, qty: cmd.params.qty }];
      // Add each item via its product page's own "Add to cart" button, in the
      // user's logged-in session. The affiliate deep link (addToCartUrl) silently
      // failed to land items, so we drive the real UI and refuse to claim success
      // if the button never took.
      for (const it of items) {
        const times = it.qty && it.qty > 1 ? it.qty : 1;
        for (let n = 0; n < times; n++) {
          await navigate(tabId, `${WALMART}/ip/${it.productId}`);
          const r = await action('add-to-cart', { productId: it.productId });
          if (!r || !r.ok || !r.added) throw new Error(`could not add ${it.productId} to cart`);
        }
      }
      await navigate(tabId, `${WALMART}/cart`);
      const res = await action('scrape-cart');
      // Verify the add actually landed. `add-to-cart` reports success on merely
      // *clicking* an add button, which can no-op (out-of-stock, needs options) or
      // mis-fire on a recommendation. Now that scrape-cart is scoped to real line
      // items (price-per-unit lines + scheduled tiles, no recommendations), a
      // requested id missing from the cart means the add silently failed — so we
      // surface ok:false instead of a false success.
      const cart = (res && res.cart) || [];
      const missing = items
        .map((it) => String(it.productId))
        .filter((id) => !cart.some((c) => String(c.productId) === id));
      if (missing.length) {
        return { ok: false, error: `add did not land in cart: ${missing.join(', ')}`, cart };
      }
      return res;
    }
    case 'remove-item': {
      await navigate(tabId, `${WALMART}/cart`);
      const r = await action('remove-item', { productId: cmd.params.productId });
      // The content script reports `removed` from a post-op cart re-scrape (id
      // gone = true). A click that never landed on the line leaves it present, so
      // surface that as a failure instead of a false success.
      if (!r || !r.ok || !r.removed) {
        throw new Error(`could not remove ${cmd.params.productId} from cart`);
      }
      return r;
    }
    default:
      throw new Error(`unknown op: ${cmd.op}`);
  }
}

async function runCommand(cmd) {
  try {
    const resp = await executeCommand(cmd);
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'no response from page');
    const result = {};
    if (resp.cart) result.cart = resp.cart;
    if (resp.history) result.history = resp.history;
    if (resp.deliveries) result.deliveries = resp.deliveries;
    await lifeos('/api/grocery/walmart/result', { method: 'POST', body: JSON.stringify({ id: cmd.id, ok: true, result }) });
    flash('OK');
  } catch (e) {
    console.error('[LifeOS] command failed', cmd, e);
    await lifeos('/api/grocery/walmart/result', {
      method: 'POST',
      body: JSON.stringify({ id: cmd.id, ok: false, error: String((e && e.message) || e) }),
    }).catch(() => {});
    flash('ERR');
  }
}

let polling = false;

// Long-poll loop. Each GET holds open ~20s server-side; an in-flight fetch keeps
// the worker alive. The alarm restarts the loop if the worker is ever killed.
async function pollLoop() {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      const { lifeosUrl, token } = await getConfig();
      if (!lifeosUrl || !token) break; // unconfigured — stop until next alarm
      try {
        const data = await lifeos('/api/grocery/walmart/commands', { method: 'GET' });
        for (const cmd of (data && data.commands) || []) await runCommand(cmd);
      } catch (e) {
        await sleep(3000); // network/LifeOS down — back off, alarm will retry
      }
    }
  } finally {
    polling = false;
  }
}

api.alarms.create('lifeos-poll', { periodInMinutes: 0.5 });
api.alarms.onAlarm.addListener((a) => { if (a.name === 'lifeos-poll') pollLoop(); });
api.runtime.onStartup.addListener(() => pollLoop());
api.runtime.onInstalled.addListener(() => {
  api.alarms.create('lifeos-poll', { periodInMinutes: 0.5 });
  pollLoop();
});
pollLoop();
