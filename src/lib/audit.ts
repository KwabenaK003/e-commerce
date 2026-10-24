import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { clientIp, ipForDb } from '@/lib/security/request';
import { logger } from '@/lib/logger';

/**
 * Every admin write calls this. The audit log is how you answer "who changed that price?".
 * A failure to write the log is reported but never blocks the action itself.
 */
export async function audit(args: {
  actorId: string | null;
  action: string; // e.g. 'product.price_changed'
  entityType: string; // e.g. 'product'
  entityId: string;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    let ip: string | null = null;
    try {
      ip = ipForDb(await clientIp());
    } catch {
      ip = null; // outside a request (jobs)
    }
    const { error } = await adminClient()
      .from('audit_log')
      .insert({
        actor_id: args.actorId,
        action: args.action,
        entity_type: args.entityType,
        entity_id: args.entityId,
        before: args.before ?? null,
        after: args.after ?? null,
        ip,
      });
    if (error) throw new Error(error.message);
  } catch (e) {
    logger.error('audit log write failed', e, { action: args.action, entityId: args.entityId });
  }
}
