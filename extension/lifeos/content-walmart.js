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

  // Expand any collapsed "delivery from store / tomorrow's order" strips so their
  // items are in the DOM before we scrape. This just toggles a summary open — it
  // adds/removes nothing. Targeted to the "View more items" label so we can't
  // mis-click an order or checkout control.
  function expandCollapsedLists() {
    for (const b of document.querySelectorAll('button,a')) {
      const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.toLowerCase();
      if (/view more item|see more item|show more item/.test(label)) b.click();
    }
  }

  // Scrape the cart scoped to actual line items, not "you may also like" tiles.
  // Two representations coexist on the cart page:
  //   1. Purchasable lines each carry a `product-price-per-unit` price node
  //      (recommendation carousels do not) — anchor on it, then read the line's
  //      `/ip/<id>` link + name. This is what excludes the reco pollution that
  //      the raw `a[href*="/ip/"]` scan swept in.
  //   2. Scheduled "delivery from store" items in the collapsed tomorrow's-order
  //      strip render as image-only tiles with NO `/ip/` link — harvest those by
  //      their image alt (best-effort id from the image src) and tag `scheduled`.
  // Falls back to the link-only scan if Walmart ever drops the price testid.
  function scrapeCartLines() {
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
    for (const cil of document.querySelectorAll('[data-testid="collapsedItemList"]')) {
      for (const img of cil.querySelectorAll('img')) {
        if (img.closest('a[href*="/ip/"]')) continue; // already captured as a link
        const product = (img.getAttribute('alt') || '').replace(/\s+/g, ' ').trim();
        if (!product) continue;
        const src = img.getAttribute('src') || '';
        const idInSrc = src.match(/\/(\d{6,})[._]/);
        push(idInSrc ? idInSrc[1] : null, product, { scheduled: true });
      }
    }
    return items;
  }

  // Cart scrape front door: expand collapsed strips, prefer the scoped line-item
  // scrape, fall back to the raw link scan only if the scoped one finds nothing.
  function scrapeCart() {
    expandCollapsedLists();
    const scoped = scrapeCartLines();
    return scoped.length ? scoped : scrapeProducts();
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
  function clickRemove(productId) {
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

  // Walmart's cart/orders pages are React SPAs whose product tiles render after
  // the tab reports "complete". Scraping once too early returns an empty list
  // that looks identical to a genuinely empty cart. Re-scrape until products
  // appear or the window elapses; a truly empty page just costs the full wait.
  async function scrapeStable(fn, { tries = 10, gap = 700 } = {}) {
    let out = fn();
    for (let i = 0; i < tries && out.length === 0; i++) {
      await wait(gap);
      out = fn();
    }
    return out;
  }

  // Add-to-cart runs the product page's own "Add to cart" button in the user's
  // logged-in session (the affiliate deep link silently no-ops here). Keys on the
  // button's accessible label/text so a CSS redesign doesn't break it; skips the
  // post-add "Added"/quantity/remove controls so we don't mis-click.
  function clickAddToCart() {
    // Prefer Walmart's canonical primary add button. The product page also renders
    // many recommendation "Add" buttons (aria-label just "Add") — targeting the
    // stable data-automation-id keeps us from mis-clicking one of those and
    // silently adding the wrong product.
    const primary = document.querySelector('button[data-automation-id="atc"]');
    if (primary && !primary.disabled) { primary.click(); return true; }
    const btn = [...document.querySelectorAll('button')].find((b) => {
      const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.toLowerCase();
      return /add to cart/.test(label) && !/added|remove|delete|registry|list/.test(label) && !b.disabled;
    });
    if (btn) { btn.click(); return true; }
    return false;
  }
  async function addToCart() {
    for (let i = 0; i < 10; i++) {
      if (clickAddToCart()) { await wait(1500); return true; }
      await wait(700);
    }
    return false;
  }

  api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== 'lifeos-walmart-action') return;
    (async () => {
      try {
        switch (msg.action) {
          case 'scrape-cart': sendResponse({ ok: true, cart: await scrapeStable(scrapeCart) }); break;
          case 'scrape-history': sendResponse({ ok: true, history: await scrapeStable(scrapeProducts) }); break;
          case 'scrape-deliveries': sendResponse({ ok: true, deliveries: await scrapeStable(scrapeDeliveries) }); break;
          case 'add-to-cart': {
            const added = await addToCart();
            sendResponse({ ok: true, added });
            break;
          }
          case 'remove-item': {
            // The cart's React tiles paint after the tab reports "complete", so a
            // one-shot removeItem can run before the target line exists and no-op.
            // Wait for the line to render, click Remove, then re-scrape and report
            // `removed` from ground truth — the id being gone from the cart — not
            // merely from having clicked a button. background.js gates ok on this.
            const isPresent = () => scrapeCart().some((c) => String(c.productId) === String(msg.productId));
            for (let i = 0; i < 10 && !isPresent(); i++) await wait(700);
            const clicked = clickRemove(msg.productId);
            let cart = scrapeCart();
            for (let i = 0; i < 6 && cart.some((c) => String(c.productId) === String(msg.productId)); i++) {
              await wait(700);
              cart = scrapeCart();
            }
            const removed = !cart.some((c) => String(c.productId) === String(msg.productId));
            sendResponse({ ok: true, clicked, removed, cart });
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
