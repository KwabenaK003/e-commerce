import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/manrope';
import './globals.css';
import { siteConfig } from '@/config/site';
import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';
import { getSettings } from '@/lib/settings';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: `${siteConfig.name}: ${siteConfig.tagline}`, template: `%s | ${siteConfig.name}` },
  description: siteConfig.tagline,
  openGraph: { siteName: siteConfig.name, type: 'website', locale: 'en_GH' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#047857' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const banner = await getSettings()
    .then((s) => s.freeDeliveryBanner)
    .catch(() => '');
  return (
    <html lang="en-GH">
      <body className="min-h-screen antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
          Skip to content
        </a>
        <Header banner={banner} />
        <main id="main" className="mx-auto max-w-6xl px-4 py-6">
          {children}
        </main>
        <Footer />
      </body>
    </html>
  );
}
