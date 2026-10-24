import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="py-20 text-center">
      <h1 className="text-3xl font-extrabold">Page not found</h1>
      <p className="mt-2 text-zinc-600">We could not find what you were looking for.</p>
      <Link href="/" className="btn mt-6">Back to the shop</Link>
    </div>
  );
}
