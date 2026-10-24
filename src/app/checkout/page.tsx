import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCartView } from '@/lib/cart';
import { getCurrentUser } from '@/lib/auth/session';
import { getSettings } from '@/lib/settings';
import { adminClient } from '@/lib/supabase/admin';
import { CheckoutForm } from '@/components/CheckoutForm';

export const metadata: Metadata = { title: 'Checkout', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function CheckoutPage() {
  const cart = await getCartView();
  if (cart.lines.length === 0 || cart.hasIssues) redirect('/cart');

  const db = adminClient();
  const [zones, pickups, settings, user] = await Promise.all([
    db.from('delivery_zones').select('id, name, regions, fee_pesewas, free_over_pesewas, eta_min_days, eta_max_days').eq('is_active', true),
    db.from('pickup_locations').select('id, name, address, hours').eq('is_active', true),
    getSettings(),
    getCurrentUser(),
  ]);
  let defaults = { name: '', phone: '', email: '' };
  if (user) {
    const { data: p } = await db.from('profiles').select('full_name, phone, email').eq('id', user.id).maybeSingle();
    defaults = { name: p?.full_name ?? '', phone: p?.phone ?? '', email: p?.email ?? '' };
  }

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-bold">Checkout</h1>
      <CheckoutForm
        subtotalPesewas={cart.subtotalPesewas}
        zones={zones.data ?? []}
        pickups={pickups.data ?? []}
        defaults={defaults}
        codEnabled={settings.codMaxPesewas > 0}
        codMaxPesewas={settings.codMaxPesewas}
        codRegions={settings.codRegions}
      />
    </div>
  );
}
