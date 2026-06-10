// Scrapes the Walmart order-history pages for past-purchased products and sends
// them to the LifeOS background worker. Runs in YOUR logged-in session, so it
// sees the real authenticated pages — no bot wall, no credentials leave your
// browser. Read-only: it never clicks buy/reorder, only reads the DOM.
//
// Walmart's markup changes often, so this keys on the stable `/ip/<itemId>` URL
// pattern rather than CSS classes. If a Walmart redesign breaks it, update the
// selector/regex below.

(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const IP = /\/ip\/(?:[^/?#]+\/)?(\d{4,})/;

  function scrape() {
    const byId = new Map();
    for (const a of document.querySelectorAll('a[href*="/ip/"]')) {
      const m = a.href.match(IP);
      if (!m) continue;
      const productId = m[1];
      // Title: link text, aria-label, or an <img alt> inside the link
      const title = (a.textContent || a.getAttribute('aria-label') ||
        a.querySelector('img')?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
      if (!title || title.length < 3) continue;
      if (!byId.has(productId)) {
        byId.set(productId, {
          productId,
          product: title,
          productUrl: `https://www.walmart.com/ip/${productId}`,
        });
      }
    }
    return [...byId.values()];
  }

  function sync() {
    const products = scrape();
    if (products.length) {
      api.runtime.sendMessage({ type: 'lifeos-order-history', retailer: 'walmart', products });
    }
  }

  // Initial pass, then re-scrape as the order list lazy-loads / paginates.
  sync();
  let debounce;
  const obs = new MutationObserver(() => {
    clearTimeout(debounce);
    debounce = setTimeout(sync, 1500);
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();
