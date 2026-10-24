import Link from 'next/link';
import { siteConfig, whatsappLink } from '@/config/site';

export function Footer() {
  const wa = whatsappLink(`Hello ${siteConfig.name}, I have a question.`);
  return (
    <footer className="mt-16 border-t border-zinc-200 bg-white">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 text-sm sm:grid-cols-3">
        <div>
          <p className="text-lg font-extrabold text-emerald-800">{siteConfig.name}</p>
          <p className="mt-2 text-zinc-600">{siteConfig.tagline}</p>
          <p className="mt-2 text-zinc-600">{siteConfig.address}</p>
          {siteConfig.supportPhone && <p className="mt-2">Call: {siteConfig.supportPhone}</p>}
          {siteConfig.supportEmail && <p>Email: {siteConfig.supportEmail}</p>}
        </div>
        <nav aria-label="Help">
          <p className="font-semibold">Help</p>
          <ul className="mt-2 space-y-1 text-zinc-600">
            <li><Link href="/track" className="hover:underline">Track an order</Link></li>
            <li><Link href="/policies/delivery" className="hover:underline">Delivery</Link></li>
            <li><Link href="/policies/returns" className="hover:underline">Returns and refunds</Link></li>
            <li><Link href="/contact" className="hover:underline">Contact us</Link></li>
          </ul>
        </nav>
        <nav aria-label="Company">
          <p className="font-semibold">Company</p>
          <ul className="mt-2 space-y-1 text-zinc-600">
            <li><Link href="/about" className="hover:underline">About us</Link></li>
            <li><Link href="/policies/privacy" className="hover:underline">Privacy policy</Link></li>
            <li><Link href="/policies/terms" className="hover:underline">Terms of sale</Link></li>
          </ul>
        </nav>
      </div>
      <p className="border-t border-zinc-100 py-4 text-center text-xs text-zinc-500">
        &copy; {new Date().getFullYear()} {siteConfig.name}. Payments are processed securely by Paystack.
      </p>
      {wa && (
        <a href={wa} target="_blank" rel="noopener noreferrer" className="fixed bottom-4 right-4 z-30 rounded-full bg-green-600 px-4 py-3 text-sm font-bold text-white shadow-lg hover:bg-green-700" aria-label="Chat with us on WhatsApp">
          WhatsApp
        </a>
      )}
    </footer>
  );
}
