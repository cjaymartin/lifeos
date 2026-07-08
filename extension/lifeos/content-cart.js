// Scrapes the Walmart cart for the products currently in it and pushes them to
// LifeOS, which reconciles them against the built cart (present ⇒ in-cart,
// absent ⇒ pending) and persists them as the live cart. Runs in your own
// session; read-only.
//
// SCOPED scrape (mirrors content-walmart.js): the cart page is full of
// recommendation carousels that all carry `/ip/` links, so a raw
// `a[href*="/ip/"]` scan reports an EMPTY cart as ~two dozen "recommended"
// products. We anchor on the per-line `product-price-per-unit` price node (which
// recommendations never carry) and the collapsed "delivery from store" tiles, so
// an empty cart pushes an empty list. Unlike content-walmart.js we DON'T click
// "view more" to expand — this runs under a MutationObserver and a click would
// feed the observer its own DOM change; we scrape whatever is already rendered.

(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const IP = /\/ip\/(?:[^/?#]+\/)?(\d{4,})/;

  function scrape() {
    const items = [];
    const seen = new Set();
    const push = (productId, product, extra) => {
      const key = productId || product;
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push({
        productId: productId || undefined,
        product,
        productUrl: productId ? `https://www.walmart.com/ip/${productId}` : undefined,
        ...extra,
      });
    };
    // 1. Real purchasable lines each carry a per-unit price node.
    for (const price of document.querySelectorAll('[data-testid="product-price-per-unit"]')) {
      let node = price;
      for (let i = 0; i < 10 && node; i++, node = node.parentElement) {
        const a = node.querySelector('a[href*="/ip/"]');
        if (!a) continue;
        const m = a.href.match(IP);
        if (!m) continue;
        const product = (a.textContent || a.getAttribute('aria-label') ||
          a.querySelector('img')?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
        push(m[1], product);
        break;
      }
    }
    // 2. Scheduled "delivery from store" tomorrow's-order tiles: image-only, no
    //    /ip/ link. Best-effort id from the image src.
    for (const cil of document.querySelectorAll('[data-testid="collapsedItemList"]')) {
      for (const img of cil.querySelectorAll('img')) {
        if (img.closest('a[href*="/ip/"]')) continue;
        const product = (img.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
        if (!product) continue;
        const src = img.getAttribute('src') || '';
        const idInSrc = src.match(/\/(\d{6,})[._]/);
        push(idInSrc ? idInSrc[1] : null, product, { scheduled: true });
      }
    }
    return items;
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
