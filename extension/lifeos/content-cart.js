// Scrapes the Walmart cart for the products currently in it and sends their
// productIds to LifeOS, which reconciles them against the built cart (present ⇒
// in-cart, absent ⇒ pending). Runs in your own session; read-only.

(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const IP = /\/ip\/(?:[^/?#]+\/)?(\d{4,})/;

  function scrape() {
    const byId = new Map();
    for (const a of document.querySelectorAll('a[href*="/ip/"]')) {
      const m = a.href.match(IP);
      if (!m) continue;
      const productId = m[1];
      if (!byId.has(productId)) {
        const product = (a.textContent || a.getAttribute('aria-label') ||
          a.querySelector('img')?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
        byId.set(productId, { productId, product });
      }
    }
    return [...byId.values()];
  }

  function sync() {
    const items = scrape();
    // Always send (even empty) so LifeOS can reconcile "nothing landed" too.
    api.runtime.sendMessage({ type: 'lifeos-cart', retailer: 'walmart', items });
  }

  sync();
  let debounce;
  const obs = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(sync, 1500);
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();
