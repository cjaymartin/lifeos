import type { APIRoute } from 'astro';
import { generateRegistrationOptions } from '@simplewebauthn/server';
import { loadCredentials, rpConfig } from '@/lib/webauthn';
import { requireSession } from '@/lib/auth';

export const GET: APIRoute = async ({ cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  const { rpID } = rpConfig();
  const existing = await loadCredentials();

  const options = await generateRegistrationOptions({
    rpName: 'LifeOS',
    rpID,
    userName: 'cjay',
    userDisplayName: 'CJ',
    attestationType: 'none',
    excludeCredentials: existing.map((c) => ({ id: c.id, type: 'public-key' as const })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  });

  cookies.set('passkey_reg_challenge', options.challenge, {
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
