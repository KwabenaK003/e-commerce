'use client';

import { useActionState, useState } from 'react';
import { checkoutAction } from '@/actions/checkout';
import { formatGhs, shippingFee } from '@/lib/money';
import { GH_REGIONS } from '@/lib/regions';
import { Turnstile } from '@/components/Turnstile';
import { SubmitButton } from '@/components/SubmitButton';
import type { ActionState } from '@/lib/types';

interface Zone {
  id: string;
  name: string;
  regions: string[];
  fee_pesewas: number;
  free_over_pesewas: number | null;
  eta_min_days: number;
  eta_max_days: number;
}
interface Pickup {
  id: string;
  name: string;
  address: string;
  hours: string | null;
}

function Field({ name, label, state, children }: { name: string; label: string; state: ActionState; children: React.ReactNode }) {
  const err = state.fieldErrors?.[name];
  return (
    <div>
      <label htmlFor={name} className="label">{label}</label>
      {children}
      {err && <p className="err" id={`${name}-err`}>{err}</p>}
    </div>
  );
}

export function CheckoutForm(props: {
  subtotalPesewas: number;
  zones: Zone[];
  pickups: Pickup[];
  defaults: { name: string; phone: string; email: string };
  codEnabled: boolean;
  codMaxPesewas: number;
  codRegions: string[];
}) {
  const [state, action] = useActionState<ActionState, FormData>(checkoutAction, {});
  const [fulfillment, setFulfillment] = useState<'delivery' | 'pickup'>('delivery');
  const [region, setRegion] = useState('');
  const [payment, setPayment] = useState<'paystack' | 'pay_on_delivery'>('paystack');

  const zone = props.zones.find((z) => z.regions.includes(region));
  const fee = fulfillment === 'delivery' ? shippingFee(props.subtotalPesewas, zone) : 0;
  const codOk =
    props.codEnabled &&
    props.subtotalPesewas + fee <= props.codMaxPesewas &&
    (fulfillment === 'delivery') &&
    (props.codRegions.length === 0 || props.codRegions.includes(region));
  const effectivePayment = payment === 'pay_on_delivery' && !codOk ? 'paystack' : payment;

  return (
    <form action={action} className="space-y-8" noValidate>
      {state.error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}

      <fieldset className="space-y-3">
        <legend className="mb-2 text-lg font-bold">1. Your details</legend>
        <Field name="contact_name" label="Full name" state={state}><input id="contact_name" name="contact_name" autoComplete="name" defaultValue={props.defaults.name} className="input" required /></Field>
        <Field name="contact_phone" label="Phone number (for order updates)" state={state}><input id="contact_phone" name="contact_phone" type="tel" autoComplete="tel" inputMode="tel" placeholder="024 123 4567" defaultValue={props.defaults.phone} className="input" required /></Field>
        <Field name="contact_email" label="Email (optional, for your receipt)" state={state}><input id="contact_email" name="contact_email" type="email" autoComplete="email" defaultValue={props.defaults.email} className="input" /></Field>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-lg font-bold">2. Delivery</legend>
        <div className="flex gap-4">
          <label className="flex items-center gap-2"><input type="radio" name="fulfillment" value="delivery" checked={fulfillment === 'delivery'} onChange={() => setFulfillment('delivery')} /> Deliver to me</label>
          {props.pickups.length > 0 && <label className="flex items-center gap-2"><input type="radio" name="fulfillment" value="pickup" checked={fulfillment === 'pickup'} onChange={() => setFulfillment('pickup')} /> Pick up in store</label>}
        </div>
        {fulfillment === 'delivery' ? (
          <div className="space-y-3">
            <Field name="recipient_name" label="Recipient name (if different)" state={state}><input id="recipient_name" name="recipient_name" className="input" /></Field>
            <Field name="delivery_phone" label="Delivery phone (if different)" state={state}><input id="delivery_phone" name="delivery_phone" type="tel" className="input" /></Field>
            <Field name="region" label="Region" state={state}>
              <select id="region" name="region" className="input" value={region} onChange={(e) => setRegion(e.target.value)} required>
                <option value="">Choose your region</option>
                {GH_REGIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
            <Field name="town" label="Town or area" state={state}><input id="town" name="town" autoComplete="address-level2" className="input" required /></Field>
            <Field name="street_landmark" label="Street, house number or landmark" state={state}><textarea id="street_landmark" name="street_landmark" rows={2} className="input" placeholder="Near the Total filling station, blue gate" required /></Field>
            <Field name="digital_address" label="GhanaPost digital address (optional)" state={state}><input id="digital_address" name="digital_address" placeholder="GA-183-8164" className="input" /></Field>
            {region && (zone
              ? <p className="text-sm text-emerald-800">Delivery to {region}: {fee === 0 ? 'free' : formatGhs(fee)}, about {zone.eta_min_days}-{zone.eta_max_days} days.</p>
              : <p className="err">We do not deliver to {region} yet.</p>)}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="save_address" /> Save this address to my account (if signed in)</label>
          </div>
        ) : (
          <Field name="pickup_location_id" label="Pickup location" state={state}>
            <select id="pickup_location_id" name="pickup_location_id" className="input" defaultValue={props.pickups[0]?.id}>
              {props.pickups.map((p) => <option key={p.id} value={p.id}>{p.name}: {p.address}{p.hours ? ` (${p.hours})` : ''}</option>)}
            </select>
          </Field>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="mb-2 text-lg font-bold">3. Payment</legend>
        <label className="flex items-start gap-2"><input type="radio" name="payment_method" value="paystack" checked={effectivePayment === 'paystack'} onChange={() => setPayment('paystack')} className="mt-1" /><span><strong>Pay now</strong><br /><span className="text-sm text-zinc-600">Mobile money or card through Paystack.</span></span></label>
        {codOk && <label className="flex items-start gap-2"><input type="radio" name="payment_method" value="pay_on_delivery" checked={effectivePayment === 'pay_on_delivery'} onChange={() => setPayment('pay_on_delivery')} className="mt-1" /><span><strong>Pay on delivery</strong><br /><span className="text-sm text-zinc-600">We will call you to confirm the order first.</span></span></label>}
        <Field name="coupon_code" label="Coupon code (optional)" state={state}><input id="coupon_code" name="coupon_code" className="input uppercase" /></Field>
        <Field name="note" label="Note to the seller (optional)" state={state}><textarea id="note" name="note" rows={2} maxLength={500} className="input" /></Field>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="sms_marketing" className="mt-1" /> Send me offers by SMS (optional)</label>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="email_marketing" className="mt-1" /> Send me offers by email (optional)</label>
      </fieldset>

      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <p className="flex justify-between"><span>Subtotal</span><span>{formatGhs(props.subtotalPesewas)}</span></p>
        <p className="flex justify-between"><span>Delivery</span><span>{fulfillment === 'pickup' ? 'Free' : zone ? (fee === 0 ? 'Free' : formatGhs(fee)) : 'Choose region'}</span></p>
        <p className="mt-1 flex justify-between border-t pt-2 text-lg font-bold"><span>Estimated total</span><span>{formatGhs(props.subtotalPesewas + fee)}</span></p>
        <p className="mt-1 text-xs text-zinc-500">Coupons and tax are applied when you place the order.</p>
      </div>

      <Turnstile />
      <SubmitButton className="btn w-full !py-3 text-lg" pendingText="Placing your order...">
        {effectivePayment === 'paystack' ? 'Place order and pay' : 'Place order'}
      </SubmitButton>
    </form>
  );
}
