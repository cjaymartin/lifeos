import type { APIRoute } from 'astro';
import { requireSessionOrToken } from '@/lib/auth';
import { runWalmartOp } from '@/features/grocery/walmart-service';
import { WALMART_OPS, type WalmartOp } from '@/features/grocery/types';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/** POST /api/grocery/walmart/command — the single front door for on-demand
 *  Walmart cart ops (ADR 0001). Accepts the session cookie (UI) OR a bearer
 *  token (the agent CLI). Body: { op, productId?, qty? }. The service routes
 *  through the extension when present and falls back to the local session;
 *  the caller just gets a normalized WalmartOpResult. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSessionOrToken(cookies, request);
  if (denied) return denied;

  let op: WalmartOp;
  let productId: string | undefined;
  let qty: number | undefined;
  let items: { productId: string; qty?: number }[] | undefined;
  try {
    const body = (await request.json()) as {
      op?: string; productId?: unknown; qty?: unknown;
      items?: { productId?: unknown; qty?: unknown }[];
    };
    op = body.op as WalmartOp;
    if (!WALMART_OPS.includes(op)) throw new Error('bad op');
    productId = body.productId != null ? String(body.productId) : undefined;
    qty = body.qty != null ? Number(body.qty) : undefined;
    items = Array.isArray(body.items)
      ? body.items.filter((i) => i && i.productId != null).map((i) => ({ productId: String(i.productId), qty: i.qty != null ? Number(i.qty) : undefined }))
      : undefined;
    if (op === 'remove-item' && !productId) throw new Error('productId required');
    if (op === 'add-item' && !productId && !(items && items.length)) throw new Error('productId or items required');
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const result = await runWalmartOp(op, { productId, qty, items });
  return json(result, result.ok ? 200 : 502);
};
