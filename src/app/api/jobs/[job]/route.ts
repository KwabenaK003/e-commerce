import { NextResponse } from 'next/server';
import { authorizeJob } from '@/lib/jobs';
import { adminClient } from '@/lib/supabase/admin';
import { processNotifications } from '@/lib/notifications/worker';
import { sweepStuckPayments } from '@/lib/payments';
import { reconcileDay, yesterdayUtc } from '@/lib/reconcile';
import { getSettings } from '@/lib/settings';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Scheduled jobs. Vercel Cron calls GET; pg_cron (supabase/cron.sql) calls POST. Both send the bearer secret. */
async function run(req: Request, ctx: { params: Promise<{ job: string }> }) {
  if (!authorizeJob(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { job } = await ctx.params;
  try {
    switch (job) {
      case 'send-notifications':
        return NextResponse.json(await processNotifications());
      case 'payment-sweep':
        return NextResponse.json(await sweepStuckPayments());
      case 'reconcile': {
        const day = new URL(req.url).searchParams.get('day') ?? yesterdayUtc();
        const r = await reconcileDay(day);
        return NextResponse.json({ day: r.day, status: r.status, mismatches: r.mismatches.length });
      }
      case 'low-stock-digest':
        return NextResponse.json(await lowStockDigest());
      default:
        return NextResponse.json({ error: 'unknown job' }, { status: 404 });
    }
  } catch (e) {
    logger.error(`job ${job} failed`, e);
    return NextResponse.json({ error: 'job failed' }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;

async function lowStockDigest() {
  const db = adminClient();
  const settings = await getSettings(true);
  const { data } = await db
    .from('inventory')
    .select('variant_id, on_hand, reserved, low_stock_threshold, variant:product_variants!inner(sku, name, is_active, product:products(name))')
    .eq('variant.is_active', true);
  const low = (data ?? [])
    .map((r: any) => {
      const v = Array.isArray(r.variant) ? r.variant[0] : r.variant;
      const p = v && (Array.isArray(v.product) ? v.product[0] : v.product);
      return { sku: v?.sku as string, name: `${p?.name ?? ''}${v?.name ? ` ${v.name}` : ''}`.trim(), available: r.on_hand - r.reserved, threshold: r.low_stock_threshold };
    })
    .filter((x) => x.available <= x.threshold)
    .sort((a, b) => a.available - b.available)
    .slice(0, 100);
  if (low.length === 0) return { sent: 0, low: 0 };
  const day = new Date().toISOString().slice(0, 10);
  for (const to of settings.alertEmails) {
    await db.rpc('enqueue_notification', {
      p_order_id: null,
      p_template: 'low_stock_digest',
      p_channel: 'email',
      p_recipient: to,
      p_payload: { variants: low },
      p_dedupe_suffix: day,
    });
  }
  return { sent: settings.alertEmails.length, low: low.length };
}
