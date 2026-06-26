// ── Walmart local-session fallback (Playwright) ──────────────────────────────
//
// The server-side executor for on-demand Walmart ops when the browser extension
// is unavailable (ADR 0001). It drives the persistent Chrome profile from
// Settings → Logins — the same signed-in session the login verifier uses — so
// we present as the user's returning browser rather than a fresh headless one.
//
// Caveat (documented in the ADR): Walmart's bot protection still blocks
// automated browsers more often than the user's own session, so this path is
// best-effort. Read scrapers degrade to empty results; the action paths report
// what they could confirm. The extension remains the preferred executor.

import { launchProfile } from '@/features/settings/ops/browser-session';
import { buildAddToCartUrl } from '@/features/grocery/types';
import type { WalmartCartLine, WalmartLiveDelivery } from '@/features/grocery/types';
import type { WalmartResultPayload } from '@/features/grocery/walmart-queue';
import type { Page } from 'playwright';

const CART_URL = 'https://www.walmart.com/cart';
const ORDERS_URL = 'https://www.walmart.com/orders';
const NAV_TIMEOUT = 45_000;

class SignedOutError extends Error {
  constructor() { super('Walmart local session is signed out — sign in under Settings → Logins, or use the extension'); }
}

function assertSignedIn(url: string, html: string): void {
  if (url.includes('/account/login') || html.includes('Sign in or create account'))
    throw new SignedOutError();
}

/** Scrape product lines off whatever Walmart page is loaded, keyed on the stable
 *  `/ip/<id>` URL (CSS-class-independent — same approach as the content scripts). */
function scrapeProducts(page: Page): Promise<WalmartCartLine[]> {
  return page.evaluate(() => {
    const IP = /\/ip\/(?:[^/?#]+\/)?(\d{4,})/;
    const byId = new Map<string, { productId: string; product: string; productUrl: string }>();
    for (const a of Array.from(document.querySelectorAll('a[href*="/ip/"]'))) {
      const href = (a as HTMLAnchorElement).href;
      const m = href.match(IP);
      if (!m) continue;
      const productId = m[1];
      if (byId.has(productId)) continue;
      const product = (
        a.textContent ||
        a.getAttribute('aria-label') ||
        a.querySelector('img')?.getAttribute('alt') ||
        ''
      ).replace(/\s+/g, ' ').trim();
      byId.set(productId, { productId, product, productUrl: `https://www.walmart.com/ip/${productId}` });
    }
    return Array.from(byId.values());
  });
}

/** Open a context, run `fn` on a fresh page, always close. */
async function withPage<T>(fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await launchProfile('walmart');
  try {
    const page = await ctx.newPage();
    return await fn(page);
  } finally {
    await ctx.close();
  }
}

async function goto(page: Page, url: string): Promise<void> {
  await page.goto(url, { timeout: NAV_TIMEOUT, waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500); // let client-side render settle
  assertSignedIn(page.url(), await page.content());
}

export async function sessionGetCart(): Promise<WalmartResultPayload> {
  return withPage(async (page) => {
    await goto(page, CART_URL);
    return { cart: await scrapeProducts(page) };
  });
}

export async function sessionGetHistory(): Promise<WalmartResultPayload> {
  return withPage(async (page) => {
    await goto(page, ORDERS_URL);
    const lines = await scrapeProducts(page);
    return { history: lines.map((l) => ({ productId: l.productId, product: l.product ?? '', productUrl: l.productUrl })) };
  });
}

export async function sessionGetDeliveries(): Promise<WalmartResultPayload> {
  return withPage(async (page) => {
    await goto(page, ORDERS_URL);
    // Best-effort: group products that sit near a status/ETA phrase. Walmart's
    // orders markup shifts often, so this is intentionally loose — an empty
    // result lets the service fall back to the Gmail deliveries feed.
    const deliveries = await page.evaluate(() => {
      const STATUS = /(arriving|out for delivery|shipped|delivered|preparing|on the way|expected)/i;
      const IP = /\/ip\/(?:[^/?#]+\/)?(\d{4,})/;
      const out: { status?: string; eta?: string; items: { productId?: string; product?: string }[] }[] = [];
      const cards = Array.from(document.querySelectorAll('[class*="order" i], [data-testid*="order" i], li, section'));
      for (const card of cards) {
        const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
        const sm = text.match(STATUS);
        if (!sm) continue;
        const items: { productId?: string; product?: string }[] = [];
        const seen = new Set<string>();
        for (const a of Array.from(card.querySelectorAll('a[href*="/ip/"]'))) {
          const m = (a as HTMLAnchorElement).href.match(IP);
          if (!m || seen.has(m[1])) continue;
          seen.add(m[1]);
          items.push({ productId: m[1], product: (a.textContent || '').replace(/\s+/g, ' ').trim() || undefined });
        }
        if (items.length) out.push({ status: sm[0], eta: text.slice(0, 120), items });
        if (out.length >= 20) break;
      }
      return out;
    });
    return { deliveries: deliveries as WalmartLiveDelivery[] };
  });
}

export async function sessionAddItems(items: { productId: string; qty?: number }[]): Promise<WalmartResultPayload> {
  const addUrl = buildAddToCartUrl('walmart', items);
  if (!addUrl) throw new Error('add-item requires at least one product');
  return withPage(async (page) => {
    // The affiliate add-to-cart deep link adds the items server-side in the
    // signed-in session (the same mechanism build-carts hands the user), then
    // lands on the cart — which we scrape to confirm.
    await goto(page, addUrl);
    if (!page.url().includes('/cart')) await goto(page, CART_URL);
    return { cart: await scrapeProducts(page) };
  });
}

export const sessionAddItem = (productId: string, qty = 1) => sessionAddItems([{ productId, qty }]);

export async function sessionRemoveItem(productId: string): Promise<WalmartResultPayload> {
  return withPage(async (page) => {
    await goto(page, CART_URL);
    // Find the cart line for this product and click its nearest Remove control.
    await page.evaluate((pid) => {
      const IP = /\/ip\/(?:[^/?#]+\/)?(\d{4,})/;
      const link = Array.from(document.querySelectorAll('a[href*="/ip/"]')).find((a) => {
        const m = (a as HTMLAnchorElement).href.match(IP);
        return m && m[1] === pid;
      });
      if (!link) return;
      let node: Element | null = link;
      for (let i = 0; i < 8 && node; i++, node = node.parentElement) {
        const btn = Array.from(node.querySelectorAll('button, a')).find((b) => {
          const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.toLowerCase();
          return /remove|delete/.test(label);
        }) as HTMLElement | undefined;
        if (btn) { btn.click(); return; }
      }
    }, productId);
    await page.waitForTimeout(2500);
    return { cart: await scrapeProducts(page) };
  });
}
