import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { loadSettingsSnapshot } from '@/lib/settings/account-info';

export const GET: APIRoute = async ({ cookies }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  return new Response(JSON.stringify(await loadSettingsSnapshot()), {
    headers: { 'Content-Type': 'application/json' },
  });
};
