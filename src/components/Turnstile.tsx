'use client';

import { useEffect, useRef } from 'react';
import { siteConfig } from '@/config/site';

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, opts: Record<string, unknown>) => string; remove: (id: string) => void };
  }
}

/** Cloudflare Turnstile widget. Renders nothing when no site key is configured (local dev). */
export function Turnstile() {
  const ref = useRef<HTMLDivElement>(null);
  const key = siteConfig.turnstileSiteKey;

  useEffect(() => {
    if (!key || !ref.current) return;
    let widgetId: string | undefined;
    const render = () => {
      if (window.turnstile && ref.current && !ref.current.hasChildNodes()) {
        widgetId = window.turnstile.render(ref.current, { sitekey: key, theme: 'light' });
      }
    };
    if (window.turnstile) render();
    else {
      let s = document.querySelector<HTMLScriptElement>('script[data-turnstile]');
      if (!s) {
        s = document.createElement('script');
        s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
        s.async = true;
        s.dataset.turnstile = '1';
        document.head.appendChild(s);
      }
      s.addEventListener('load', render);
    }
    return () => {
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
  }, [key]);

  if (!key) return null;
  return <div ref={ref} className="my-3" />;
}
