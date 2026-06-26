// LifeOS Walmart action executor.
//
// Runs on every walmart.com page and answers on-demand requests from the LifeOS
// background worker: scrape the cart / order history / deliveries, or remove a
// cart line. Navigation is driven by the background worker; this script only
// reads the loaded page and (for remove) clicks the cart's own Remove control.
//
// It NEVER checks out, logs in, or touches payment — add-to-cart happens via a
// deep link the worker opens, removal via the page's existing Remove button.
// Like the other content scripts it keys on the stable `/ip/<itemId>` URL so a
// Walmart redesign of CSS classes doesn't break it.

(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  const IP = /\/ip\/(?:[^/?#]+\/)?(\d{4,})/;

  function scrapeProducts() {
    const byId = new Map();
    for (const a of document.querySelectorAll('a[href*="/ip/"]')) {
      const m = a.href.match(IP);
      if (!m) continue;
      const productId = m[1];
      if (byId.has(productId)) continue;
      const product = (a.textContent || a.getAttribute('aria-label') ||
        a.querySelector('img')?.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
      byId.set(productId, { productId, product, productUrl: `https://www.walmart.com/ip/${productId}` });
    }
    return [...byId.values()];
  }

  function scrapeDeliveries() {
    const STATUS = /(arriving|out for delivery|shipped|delivered|preparing|on the way|expected)/i;
    const out = [];
    const cards = document.querySelectorAll('[class*="order" i],[data-testid*="order" i],li,section');
    for (const card of cards) {
      const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
      const sm = text.match(STATUS);
      if (!sm) continue;
      const items = [];
      const seen = new Set();
      for (const a of card.querySelectorAll('a[href*="/ip/"]')) {
        const m = a.href.match(IP);
        if (!m || seen.has(m[1])) continue;
        seen.add(m[1]);
        items.push({ productId: m[1], product: (a.textContent || '').replace(/\s+/g, ' ').trim() || undefined });
      }
      if (items.length) out.push({ status: sm[0], eta: text.slice(0, 120), items });
      if (out.length >= 20) break;
    }
    return out;
  }

  // Find the cart line for productId and click its nearest Remove control.
  function removeItem(productId) {
    const link = [...document.querySelectorAll('a[href*="/ip/"]')].find((a) => {
      const m = a.href.match(IP);
      return m && m[1] === productId;
    });
    if (!link) return false;
    let node = link;
    for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
      const btn = [...node.querySelectorAll('button,a')].find((b) =>
        /remove|delete/.test(`${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.toLowerCase()));
      if (btn) { btn.click(); return true; }
    }
    return false;
  }

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'lifeos-walmart-action') return;
    (async () => {
      try {
        switch (msg.action) {
          case 'scrape-cart': sendResponse({ ok: true, cart: scrapeProducts() }); break;
          case 'scrape-history': sendResponse({ ok: true, history: scrapeProducts() }); break;
          case 'scrape-deliveries': sendResponse({ ok: true, deliveries: scrapeDeliveries() }); break;
          case 'remove-item': {
            const removed = removeItem(msg.productId);
            await wait(2000); // let the cart re-render
            sendResponse({ ok: true, removed, cart: scrapeProducts() });
            break;
          }
          default: sendResponse({ ok: false, error: `unknown action: ${msg.action}` });
        }
      } catch (e) {
        sendResponse({ ok: false, error: String((e && e.message) || e) });
      }
    })();
    return true; // keep the message channel open for the async sendResponse
  });
})();
