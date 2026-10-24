import 'server-only';
import { isIP } from 'node:net';
import { headers } from 'next/headers';

/** Best-effort client IP. On Vercel the first x-forwarded-for entry is the real client. */
export async function clientIp(): Promise<string> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = forwarded || h.get('x-real-ip') || '';
  return isIP(ip) ? ip : 'unknown';
}

/** The value for an `inet` column: a valid IP, or null. */
export function ipForDb(ip: string): string | null {
  return isIP(ip) ? ip : null;
}
