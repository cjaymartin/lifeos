import type { APIRoute } from 'astro';
import { requireSessionOrToken } from '@/lib/auth';
import { recordResult, type WalmartResultPayload } from '@/features/grocery/walmart-queue';

const json = (data: unknown) =>
  new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

/** POST /api/grocery/walmart/result — the extension reports the outcome of a
 *  claimed command. Body: { id, ok, result?, error? }. Bearer-guarded. */
export const POST: APIRoute = async ({ cookies, request }) => {
  const denied = requireSessionOrToken(cookies, request);
  if (denied) return denied;

  let id: string;
  let ok: boolean;
  let result: WalmartResultPayload | undefined;
  let error: string | undefined;
  try {
    const body = (await request.json()) as { id?: string; ok?: unknown; result?: WalmartResultPayload; error?: unknown };
    id = String(body.id ?? '');
    if (!id) throw new Error('id required');
    ok = !!body.ok;
    result = body.result;
    error = body.error != null ? String(body.error) : undefined;
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  await recordResult(id, ok ? { ok: true, result: result ?? {} } : { ok: false, error: error ?? 'unknown error' });
  return json({ ok: true });
};
