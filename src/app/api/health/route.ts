import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Uptime check: confirms the app can reach the database. Reveals nothing else. */
export async function GET() {
  try {
    const { error } = await adminClient().from('store_settings').select('key').limit(1);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
