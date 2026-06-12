import { verify } from 'otplib';

export async function verifyTOTP(token: string): Promise<boolean> {
  // process.env ONLY — never import.meta.env (baked into dist/ at build, NIM-7).
  const secret = process.env.TOTP_SECRET;
  if (!secret || !/^\d{6}$/.test(token.replace(/\s/g, ''))) return false;
  const result = await verify({ token: token.replace(/\s/g, ''), secret, epochTolerance: 30 });
  return result.valid;
}
