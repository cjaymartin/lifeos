// LifeOS Grocery Sync — background service worker.
// Receives scraped products/cart from the content scripts and POSTs them to
// the configured LifeOS instance with the bearer (session) token. The content
// scripts can't call LifeOS directly (cross-origin + no host permission), so
// all network egress happens here where the user-granted host permission lives.

const api = globalThis.browser ?? globalThis.chrome;

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

async function post(path, body) {
  const { lifeosUrl, token } = await getConfig();
  if (!lifeosUrl || !token) {
    console.warn('[LifeOS] Not configured — open the extension options and set the LifeOS URL + token.');
    flash('SET');
    return;
  }
  const url = lifeosUrl.replace(/\/+$/, '') + path;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`[LifeOS] ${path} → HTTP ${res.status}`);
      flash('ERR');
      return;
    }
    const data = await res.json().catch(() => ({}));
    console.log(`[LifeOS] ${path} ok`, data);
    flash('OK');
  } catch (e) {
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
