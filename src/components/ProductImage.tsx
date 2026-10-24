import Image from 'next/image';
import { isLocalUrl, productImageUrl } from '@/lib/storage';

export function ProductImage({
  path,
  alt,
  sizes = '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw',
  priority = false,
}: {
  path: string | null | undefined;
  alt: string;
  sizes?: string;
  priority?: boolean;
}) {
  const url = productImageUrl(path);
  if (!url) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-zinc-100 text-xs text-zinc-400" role="img" aria-label={alt}>
        No image
      </div>
    );
  }
  return <Image src={url} alt={alt} fill sizes={sizes} priority={priority} unoptimized={isLocalUrl(url)} className="object-cover" />;
}
