// ── Walmart on-demand op service ─────────────────────────────────────────────
//
// The single entry point the API front door (and, through it, the agent CLI and
// the UI) calls to run a Walmart cart operation. It hides the transport choice
// (ADR 0001): prefer the browser extension when it is present, fall back to the
// local Playwright session otherwise, and — for deliveries — fall back again to
// the Gmail-based deliveries feed. Callers get one normalized WalmartOpResult
// and never need to know which executor ran.

import {
  enqueueCommand, getCommand, extensionFresh, type WalmartResultPayload,
} from '@/features/grocery/walmart-queue';
import {
  sessionGetCart, sessionGetHistory, sessionGetDeliveries, sessionAddItems, sessionRemoveItem,
} from '@/features/grocery/walmart-session';
import { loadDeliveries } from '@/features/deliveries/ops';
import type {
  WalmartOp, WalmartOpParams, WalmartOpResult, WalmartExecutor, WalmartLiveDelivery,
} from '@/features/grocery/types';

/** Treat the extension as present if it polled within this window. */
const EXT_PRESENCE_MS = 45_000;
/** How long the front door waits for the extension to complete a command before
 *  giving up and using the Playwright fallback. Slightly under the extension's
 *  long-poll window so a command in flight has time to land. */
const EXT_WAIT_MS = 22_000;
const WAIT_POLL_MS = 500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Poll the queue until the enqueued command resolves, errors, or times out. */
async function waitForExtension(
  id: string,
): Promise<{ payload: WalmartResultPayload } | { error: string } | null> {
  const deadline = Date.now() + EXT_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(WAIT_POLL_MS);
    const cmd = await getCommand(id);
    if (!cmd) return { error: 'command dropped from queue' };
    if (cmd.status === 'done') return { payload: cmd.result ?? {} };
    if (cmd.status === 'error') return { error: cmd.error ?? 'extension reported an error' };
  }
  return null; // timed out — caller falls back
}

function runFallback(op: WalmartOp, params: WalmartOpParams): Promise<WalmartResultPayload> {
  switch (op) {
    case 'get-cart': return sessionGetCart();
    case 'get-history': return sessionGetHistory();
    case 'get-deliveries': return sessionGetDeliveries();
    case 'add-item': {
      const items = params.items?.length
        ? params.items
        : params.productId ? [{ productId: params.productId, qty: params.qty ?? 1 }] : [];
      if (!items.length) throw new Error('add-item requires a productId or items');
      return sessionAddItems(items);
    }
    case 'remove-item':
      if (!params.productId) throw new Error('remove-item requires a productId');
      return sessionRemoveItem(params.productId);
  }
}

/** Pending Walmart deliveries from the Gmail-based deliveries feed — the last
 *  resort for get-deliveries when no live executor returns any. */
async function deliveriesFromGmail(): Promise<WalmartLiveDelivery[]> {
  const data = await loadDeliveries();
  if (!data) return [];
  return data.deliveries
    .filter((d) => /walmart/i.test(d.vendor) && d.status !== 'delivered')
    .map((d) => ({
      orderId: d.id,
      status: d.status,
      eta: d.etaWindow ? `${d.eta ?? ''} ${d.etaWindow}`.trim() : d.eta,
      items: [{ product: d.item }],
    }));
}

/** Normalize an executor payload into the op's WalmartOpResult shape. */
function shape(op: WalmartOp, payload: WalmartResultPayload, executor: WalmartExecutor): WalmartOpResult {
  switch (op) {
    case 'get-cart':
    case 'add-item':
    case 'remove-item':
      return { ok: true, op, executor, cart: payload.cart ?? [] };
    case 'get-history':
      return {
        ok: true, op, executor,
        history: (payload.history ?? []).map((h) => ({ retailer: 'walmart' as const, ...h })),
      };
    case 'get-deliveries':
      return { ok: true, op, executor, deliveries: payload.deliveries ?? [], source: 'walmart' };
  }
}

/**
 * Run an on-demand Walmart operation, routing through the extension when present
 * and falling back to the local session. Always resolves with a WalmartOpResult
 * (ok:false carries the reason) — it never throws for an operational failure.
 */
export async function runWalmartOp(op: WalmartOp, params: WalmartOpParams = {}): Promise<WalmartOpResult> {
  // 1) Extension path — only attempted when a recent poll proves it's listening.
  if (await extensionFresh(EXT_PRESENCE_MS)) {
    const cmd = await enqueueCommand(op, params);
    const res = await waitForExtension(cmd.id);
    if (res && 'payload' in res) return shape(op, res.payload, 'extension');
    // error or timeout → fall through to the local session
  }

  // 2) Local Playwright session.
  try {
    const payload = await runFallback(op, params);
    const shaped = shape(op, payload, 'fallback');
    // 3) Deliveries-only last resort: nothing live → serve the Gmail feed.
    if (op === 'get-deliveries' && (shaped.deliveries?.length ?? 0) === 0) {
      const gmail = await deliveriesFromGmail();
      return { ok: true, op, executor: 'fallback', deliveries: gmail, source: 'gmail' };
    }
    return shaped;
  } catch (e) {
    if (op === 'get-deliveries') {
      const gmail = await deliveriesFromGmail();
      if (gmail.length) return { ok: true, op, executor: 'fallback', deliveries: gmail, source: 'gmail' };
    }
    return { ok: false, op, error: errMsg(e) };
  }
}
