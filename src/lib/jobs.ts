import 'server-only';
import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Job endpoints (/api/jobs/*) require "Authorization: Bearer <CRON_SECRET>".
 * Vercel Cron sends that header automatically when CRON_SECRET is set; the pg_cron
 * schedules in supabase/cron.sql send it too. Compared in constant time.
 */
export function authorizeJob(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return false;
  const a = createHash('sha256').update(token).digest();
  const b = createHash('sha256').update(secret).digest();
  return timingSafeEqual(a, b);
}
