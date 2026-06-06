import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { loadSettingsSnapshot } from '@/lib/settings/account-info';

export const GET: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  return new Response(JSON.stringify(await loadSettingsSnapshot()), {
    headers: { 'Content-Type': 'application/json' },
  });
};
