import { NextResponse } from 'next/server';
import { verifyStandardWebhook } from '@/lib/security/webhook-signature';
import { sendSms } from '@/lib/messaging/sms';
import { siteConfig } from '@/config/site';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Supabase "Send SMS" auth hook. Supabase generates the one-time code and calls this endpoint;
 * we deliver it through Arkesel. Configure in Supabase: Authentication > Hooks > Send SMS > HTTPS,
 * URL https://YOUR-SITE/api/auth/sms-hook, and put the generated secret in SEND_SMS_HOOK_SECRET.
 */
export async function POST(req: Request) {
  const body = await req.text();
  const ok = verifyStandardWebhook({
    body,
    id: req.headers.get('webhook-id'),
    timestamp: req.headers.get('webhook-timestamp'),
    signature: req.headers.get('webhook-signature'),
    secret: process.env.SEND_SMS_HOOK_SECRET ?? '',
  });
  if (!ok) return NextResponse.json({ error: { http_code: 401, message: 'invalid signature' } }, { status: 401 });

  try {
    const { user, sms } = JSON.parse(body) as { user?: { phone?: string }; sms?: { otp?: string } };
    if (!user?.phone || !sms?.otp) return NextResponse.json({ error: { http_code: 400, message: 'bad payload' } }, { status: 400 });
    const to = user.phone.startsWith('+') ? user.phone : `+${user.phone}`;
    await sendSms(to, `Your ${siteConfig.name} code is ${sms.otp}. It expires in 5 minutes. Never share it.`);
    return NextResponse.json({});
  } catch (e) {
    logger.error('sms hook failed', e);
    return NextResponse.json({ error: { http_code: 500, message: 'could not send sms' } }, { status: 500 });
  }
}
