import type { Metadata } from 'next';
import { siteConfig } from '@/config/site';

export const metadata: Metadata = { title: 'About us' };

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">About {siteConfig.name}</h1>
      <p className="text-zinc-700">{siteConfig.name} is an online store serving customers across Ghana. {siteConfig.tagline}.</p>
      <p className="text-zinc-700">Replace this text with your story, your business registration details and what makes your store trustworthy.</p>
      <p className="text-zinc-700">Find us at {siteConfig.address}.</p>
    </article>
  );
}
