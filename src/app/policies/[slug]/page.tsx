import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { siteConfig } from '@/config/site';

/**
 * PLACEHOLDER policy text. Have it reviewed against your real delivery, returns and data
 * handling practices (and the Data Protection Act, 2012, Act 843) before launch.
 */
const POLICIES: Record<string, { title: string; body: string[] }> = {
  delivery: {
    title: 'Delivery policy',
    body: [
      `${siteConfig.name} delivers to all 16 regions of Ghana. Delivery fees and estimated times are shown at checkout before you pay and depend on your region.`,
      'You will receive an SMS when your order is paid, when it is dispatched (with the rider or courier details) and when it is delivered.',
      'Please make sure your phone is on and give a clear landmark. If a delivery fails we will contact you to arrange another attempt.',
      'Store pickup is available where a pickup location is shown at checkout.',
    ],
  },
  returns: {
    title: 'Returns and refunds',
    body: [
      'You can request a return from your order page once the order is delivered, within the return window shown on your order.',
      'Items must be unused and in their original packaging. Tell us what is wrong and, if you like, whether you want a refund or an exchange.',
      'Approved refunds are sent back to the original payment method through Paystack and can take a few business days to appear.',
      'Delivery fees are not refunded unless the item was faulty or wrong.',
    ],
  },
  privacy: {
    title: 'Privacy policy',
    body: [
      `${siteConfig.name} collects your name, phone number, delivery address and (optionally) email to process and deliver your orders and to contact you about them.`,
      'Card and mobile money details are entered on Paystack and are never stored by us.',
      'We send marketing messages only if you tick the box to agree, and you can withdraw consent at any time in your account or by contacting us.',
      'We keep order records as long as the law requires. You may ask to see, correct or delete your personal data by contacting us.',
    ],
  },
  terms: {
    title: 'Terms of sale',
    body: [
      'Prices are in Ghana cedis. An order is accepted when payment is confirmed (or, for pay on delivery, when we confirm it with you).',
      'Items are held for you for a short time while you pay. If payment is not completed the hold is released.',
      'We may cancel an order if an item is unavailable or a pricing error occurred, and will refund any payment made.',
      'Nothing in these terms limits your statutory consumer rights.',
    ],
  },
};

export function generateStaticParams() {
  return Object.keys(POLICIES).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = POLICIES[(await params).slug];
  return { title: p?.title ?? 'Policy' };
}

export default async function PolicyPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = POLICIES[(await params).slug];
  if (!p) notFound();
  return (
    <article className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">{p.title}</h1>
      {p.body.map((t) => <p key={t} className="text-zinc-700">{t}</p>)}
      <p className="text-sm text-zinc-500">Questions? Contact us at {siteConfig.supportEmail || siteConfig.supportPhone || 'the details on our contact page'}.</p>
    </article>
  );
}
