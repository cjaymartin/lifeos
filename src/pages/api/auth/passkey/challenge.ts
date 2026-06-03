import type { APIRoute } from 'astro';
import { generateAuthenticationOptions } from '@simplewebauthn/server';
import { loadCredentials, rpConfig } from '@/lib/webauthn';

export const GET: APIRoute = async ({ cookies }) => {
  const { rpID } = rpConfig();
  const creds = await loadCredentials();

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map((c) => ({ id: c.id, type: 'public-key' as const, transports: c.transports })),
    userVerification: 'preferred',
  });

  cookies.set('passkey_challenge', options.challenge, {
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
    maxAge: 120,
    path: '/',
  });

  return new Response(JSON.stringify(options), {
    headers: { 'Content-Type': 'application/json' },
  });
};
