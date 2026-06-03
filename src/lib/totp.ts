import { verify } from 'otplib';

export async function verifyTOTP(token: string): Promise<boolean> {
  const secret = import.meta.env.TOTP_SECRET;
  if (!secret || !/^\d{6}$/.test(token.replace(/\s/g, ''))) return false;
  const result = await verify({ token: token.replace(/\s/g, ''), secret, epochTolerance: 30 });
  return result.valid;
}
