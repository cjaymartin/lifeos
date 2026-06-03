import type { APIRoute } from 'astro';
import { verifyRegistrationResponse } from '@simplewebauthn/server';
import { saveCredential, rpConfig } from '@/lib/webauthn';
import { verifySession } from '@/lib/auth';

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? '')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
  }

  const challenge = cookies.get('passkey_reg_challenge')?.value;
  cookies.delete('passkey_reg_challenge', { path: '/' });

  if (!challenge) return new Response(JSON.stringify({ error: 'No challenge' }), { status: 400 });

  const body = await request.json().catch(() => null);
  if (!body) return new Response(JSON.stringify({ error: 'Bad request' }), { status: 400 });

  const { rpID, origins } = rpConfig();

  try {
    const { verified, registrationInfo } = await verifyRegistrationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origins,
      expectedRPID: rpID,
      requireUserVerification: false,
    });

    if (!verified || !registrationInfo) {
      return new Response(JSON.stringify({ error: 'Verification failed' }), { status: 401 });
    }

    const { credential } = registrationInfo;
    await saveCredential({
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter,
      transports: body.response.response?.transports,
      name: body.name ?? 'Passkey',
      createdAt: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
};
