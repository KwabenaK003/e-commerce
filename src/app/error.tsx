'use client';

import { useEffect } from 'react';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="py-20 text-center">
      <h1 className="text-3xl font-extrabold">Something went wrong</h1>
      <p className="mt-2 text-zinc-600">Please try again. If it keeps happening, contact us{error.digest ? ` and quote ${error.digest}` : ''}.</p>
      <button onClick={reset} className="btn mt-6" type="button">Try again</button>
    </div>
  );
}
