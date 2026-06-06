import type { APIRoute } from 'astro';
import { verifyAuthenticationResponse } from '@simplewebauthn/server';
import { loadCredentials, toWebAuthnCredential, updateCounter, rpConfig } from '@/lib/webauthn';
import { setSession, getSessionSecret } from '@/lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  const challenge = cookies.get('passkey_challenge')?.value;
  cookies.delete('passkey_challenge', { path: '/' });

  if (!challenge) {
    return new Response(JSON.stringify({ error: 'No challenge' }), { status: 400 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });

  const { rpID, origins } = rpConfig();
  const creds = await loadCredentials();
  const stored = creds.find((c) => c.id === body.id);

  if (!stored) {
    return new Response(JSON.stringify({ error: 'Unknown credential' }), { status: 401 });
  }

  try {
    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
      response: body,
      expectedChallenge: challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      credential: toWebAuthnCredential(stored),
    });

    if (!verified) {
      return new Response(JSON.stringify({ error: 'Verification failed' }), { status: 401 });
    }

    await updateCounter(stored.id, authenticationInfo.newCounter);
    setSession(cookies, getSessionSecret());

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Verification error' }), { status: 401 });
  }
};
