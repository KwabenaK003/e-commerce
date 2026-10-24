import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { getSettings } from '@/lib/settings';
import { logger } from '@/lib/logger';

/**
 * Tells the owners something needs attention (reconciliation mismatch, payment trouble,
 * failed notifications). Goes through the notifications outbox like every other message, so
 * it is retried and de-duplicated: the same dedupeKey never sends twice.
 */
export async function alertOwners(args: { title: string; lines: string[]; dedupeKey: string }): Promise<void> {
  try {
    const settings = await getSettings(true);
    const db = adminClient();
    const payload = { title: args.title, lines: args.lines.slice(0, 40) };
    const recipients: Array<{ channel: 'email' | 'sms'; to: string }> = [
      ...settings.alertEmails.map((to) => ({ channel: 'email' as const, to })),
      ...settings.alertPhones.map((to) => ({ channel: 'sms' as const, to })),
    ];
    if (recipients.length === 0) {
      logger.warn('alert not sent: no alert recipients configured in Settings', { title: args.title });
      return;
    }
    for (const r of recipients) {
      const { error } = await db.rpc('enqueue_notification', {
        p_order_id: null,
        p_template: 'system_alert',
        p_channel: r.channel,
        p_recipient: r.to,
        p_payload: payload,
        p_dedupe_suffix: args.dedupeKey,
      });
      if (error) throw new Error(error.message);
    }
  } catch (e) {
    logger.error('could not queue owner alert', e, { title: args.title });
  }
}
