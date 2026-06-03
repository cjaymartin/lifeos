import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ cookies }) => {
  cookies.delete('lifeos_session', { path: '/' });
  return new Response(null, { status: 302, headers: { Location: '/login' } });
};
