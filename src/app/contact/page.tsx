import type { Metadata } from 'next';
import { siteConfig, whatsappLink } from '@/config/site';

export const metadata: Metadata = { title: 'Contact us' };

export default function ContactPage() {
  const wa = whatsappLink(`Hello ${siteConfig.name}`);
  return (
    <article className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Contact us</h1>
      <ul className="space-y-2 text-zinc-700">
        {siteConfig.supportPhone && <li>Phone: <a className="font-semibold underline" href={`tel:${siteConfig.supportPhone}`}>{siteConfig.supportPhone}</a></li>}
        {siteConfig.supportEmail && <li>Email: <a className="font-semibold underline" href={`mailto:${siteConfig.supportEmail}`}>{siteConfig.supportEmail}</a></li>}
        {wa && <li>WhatsApp: <a className="font-semibold underline" href={wa} target="_blank" rel="noopener noreferrer">Chat with us</a></li>}
        <li>Address: {siteConfig.address}</li>
      </ul>
      <p className="text-sm text-zinc-500">Have an order number ready and we can help faster.</p>
    </article>
  );
}
