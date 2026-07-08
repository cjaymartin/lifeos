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
const EXT_PRESENCE_MS = Number(process.env.LIFEOS_WM_PRESENCE_MS) || 45_000;
/** How long the front door waits for the extension to complete a command before
 *  giving up and using the Playwright fallback. Slightly under the extension's
 *  long-poll window so a command in flight has time to land. */
const EXT_WAIT_MS = Number(process.env.LIFEOS_WM_WAIT_MS) || 22_000;
const WAIT_POLL_MS = 500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Ops that change the real cart. If the extension is handed one of these and
 *  then only *times out* (outcome unknown — it may still be mid-navigation),
 *  running the Playwright fallback on top would risk a duplicate add/remove, so
 *  we bail instead. A definitive extension *error* means nothing changed, so the
 *  fallback stays safe for those. */
const MUTATING_OPS: WalmartOp[] = ['add-item', 'remove-item'];

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

/** get-deliveries last resort (ADR 0001): if whichever live executor ran turned
 *  up no deliveries, serve the Gmail-based feed instead — applies equally to the
 *  extension and the Playwright session. Non-deliveries results pass through. */
async function deliveriesBackstop(shaped: WalmartOpResult): Promise<WalmartOpResult> {
  if (shaped.op === 'get-deliveries' && (shaped.deliveries?.length ?? 0) === 0) {
    return { ok: true, op: 'get-deliveries', executor: 'fallback', deliveries: await deliveriesFromGmail(), source: 'gmail' };
  }
  return shaped;
}

/** Confirm an add-item actually landed: every requested productId must appear as
 *  a line in the resulting cart. The extension verifies this itself (and errors
 *  out if it can't), but the Playwright fallback's affiliate deep link can no-op
 *  silently — out of stock, needs options, or bot-blocked — while still landing
 *  on a cart page, so without this check it would report ok:true on an empty or
 *  unchanged cart. Non-add ops and already-failed results pass through. */
function verifyAdd(op: WalmartOp, params: WalmartOpParams, result: WalmartOpResult): WalmartOpResult {
  if (op !== 'add-item' || !result.ok) return result;
  const requested = (params.items?.length
    ? params.items.map((i) => i.productId)
    : params.productId ? [params.productId] : []
  ).map(String);
  const cart = result.cart ?? [];
  const missing = requested.filter((id) => !cart.some((c) => String(c.productId) === id));
  if (missing.length) {
    return { ok: false, op, error: `add did not land in cart: ${missing.join(', ')}` };
  }
  return result;
}

/** Confirm a remove-item actually took: the requested productId must be absent
 *  from the resulting cart. Like the add path, the Playwright fallback's Remove
 *  click can no-op on a not-yet-rendered line and still return a cart, so without
 *  this a failed remove would report ok:true. The extension verifies this itself;
 *  this guards the fallback. Non-remove ops and already-failed results pass. */
function verifyRemove(op: WalmartOp, params: WalmartOpParams, result: WalmartOpResult): WalmartOpResult {
  if (op !== 'remove-item' || !result.ok || !params.productId) return result;
  const stillPresent = (result.cart ?? []).some((c) => String(c.productId) === String(params.productId));
  if (stillPresent) {
    return { ok: false, op, error: `remove did not take: ${params.productId} still in cart` };
  }
  return result;
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
    if (res && 'payload' in res) return deliveriesBackstop(shape(op, res.payload, 'extension'));
    // A timeout (res === null) leaves a mutating op's outcome unknown — the
    // extension may still be completing the add/remove. Falling back to the
    // Playwright session here would double-execute, so bail instead.
    if (res === null && MUTATING_OPS.includes(op)) {
      return {
        ok: false, op,
        error: 'extension timed out mid-operation; not retried to avoid a duplicate cart change',
      };
    }
    // A definitive extension *error* on a mutating op (e.g. the add clicked but
    // the item never landed in the cart, or the SKU is out of stock) must not
    // fall through to the Playwright session: a retry there risks a duplicate
    // add/remove, and the extension's own post-op cart scrape already knows the
    // truth. Surface it as ok:false instead of masking it with a fallback that
    // reports ok:true on an empty cart. Reads stay idempotent and fall through.
    if (res && 'error' in res && MUTATING_OPS.includes(op)) {
      return { ok: false, op, error: res.error };
    }
    // read error, or read timeout → fall through to the local session
  }

  // 2) Local Playwright session (with the deliveries Gmail backstop, step 3).
  try {
    const payload = await runFallback(op, params);
    const shaped = await deliveriesBackstop(shape(op, payload, 'fallback'));
    return verifyRemove(op, params, verifyAdd(op, params, shaped));
  } catch (e) {
    if (op === 'get-deliveries') {
      const gmail = await deliveriesFromGmail();
      if (gmail.length) return { ok: true, op, executor: 'fallback', deliveries: gmail, source: 'gmail' };
    }
    return { ok: false, op, error: errMsg(e) };
  }
}
