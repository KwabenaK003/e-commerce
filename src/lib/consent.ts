import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { clientIp, ipForDb } from '@/lib/security/request';
import { logger } from '@/lib/logger';

/**
 * Marketing consent is recorded every time it is given or withdrawn (who, which channel,
 * where, from which IP). Transactional messages about an order do not need consent.
 */
export async function recordConsent(args: {
  userId?: string | null;
  email?: string | null;
  phone?: string | null;
  channel: 'email' | 'sms';
  granted: boolean;
  source: 'checkout' | 'account' | 'admin';
}): Promise<void> {
  if (!args.userId && !args.email && !args.phone) return;
  try {
    let ip: string | null = null;
    try {
      ip = ipForDb(await clientIp());
    } catch {
      ip = null;
    }
    const { error } = await adminClient()
      .from('consent_log')
      .insert({
        user_id: args.userId ?? null,
        email: args.email ?? null,
        phone: args.phone ?? null,
        channel: args.channel,
        granted: args.granted,
        source: args.source,
        ip,
      });
    if (error) throw new Error(error.message);
  } catch (e) {
    logger.error('consent log write failed', e);
  }
}
