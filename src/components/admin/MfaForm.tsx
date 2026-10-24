'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowser } from '@/lib/supabase/browser';

/** Two-factor sign-in with an authenticator app (TOTP). enroll = first time, verify = every sign-in. */
export function MfaForm({ mode }: { mode: 'enroll' | 'verify' }) {
  const router = useRouter();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createSupabaseBrowser();
    (async () => {
      if (mode === 'enroll') {
        // remove any half-finished enrolment first
        const { data: list } = await supabase.auth.mfa.listFactors();
        for (const f of list?.all ?? []) if (f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
        const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' });
        if (error) return setError(error.message);
        setFactorId(data.id);
        setQr(data.totp.qr_code);
        setSecret(data.totp.secret);
      } else {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) return setError(error.message);
        const totp = data.totp[0];
        if (!totp) return setError('No authenticator is set up for this account.');
        setFactorId(totp.id);
      }
    })();
  }, [mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!factorId) return;
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowser();
    const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({ factorId });
    if (cErr) {
      setBusy(false);
      return setError(cErr.message);
    }
    const { error: vErr } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code: code.trim() });
    if (vErr) {
      setBusy(false);
      return setError('That code is not right. Check the 6 digits and try again.');
    }
    router.push('/admin');
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {mode === 'enroll' ? (
        <>
          <p className="text-sm text-zinc-600">
            Scan this QR code with an authenticator app (Google Authenticator, Authy, 1Password), then enter the 6-digit code it shows.
          </p>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt="QR code for your authenticator app" className="mx-auto h-44 w-44" />
          ) : (
            <p className="text-sm text-zinc-500">Preparing your code...</p>
          )}
          {secret ? <p className="break-all text-center text-xs text-zinc-500">Can&apos;t scan? Enter this key: <code>{secret}</code></p> : null}
        </>
      ) : (
        <p className="text-sm text-zinc-600">Enter the 6-digit code from your authenticator app.</p>
      )}
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
        inputMode="numeric"
        autoComplete="one-time-code"
        placeholder="123456"
        className="w-full rounded-md border border-zinc-300 px-3 py-2 text-center text-lg tracking-widest"
        aria-label="6-digit code"
      />
      {error ? <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
      <button disabled={busy || code.length !== 6 || !factorId} className="w-full rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60">
        {busy ? 'Checking...' : mode === 'enroll' ? 'Turn on two-factor' : 'Verify'}
      </button>
    </form>
  );
}
