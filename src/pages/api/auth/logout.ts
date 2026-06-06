import type { APIRoute } from 'astro';
import { SESSION_COOKIE } from '@/lib/auth';

export const POST: APIRoute = async ({ cookies }) => {
  cookies.delete(SESSION_COOKIE, { path: '/' });
  return new Response(null, { status: 302, headers: { Location: '/login' } });
};
