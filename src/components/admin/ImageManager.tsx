import { ActionForm, SubmitButton } from '@/components/admin/forms';
import { Field, inputCls } from '@/components/admin/ui';
import { deleteImage, moveImage, uploadImages } from '@/actions/admin/catalog';
import { productImageUrl } from '@/lib/storage';

export function ImageManager({ productId, images }: { productId: string; images: Array<{ id: string; storage_path: string; alt_text: string | null }> }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <ul className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {images.map((img, i) => (
          <li key={img.id} className="rounded border border-zinc-200 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={productImageUrl(img.storage_path) ?? ''} alt={img.alt_text ?? ''} className="aspect-square w-full rounded object-cover" />
            <p className="mt-1 text-xs text-zinc-500">{i === 0 ? 'Main image' : `Image ${i + 1}`}</p>
            <div className="mt-1 flex gap-1">
              <ActionForm action={moveImage}>
                <input type="hidden" name="product_id" value={productId} />
                <input type="hidden" name="image_id" value={img.id} />
                <input type="hidden" name="dir" value="up" />
                <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs">Earlier</SubmitButton>
              </ActionForm>
              <ActionForm action={moveImage}>
                <input type="hidden" name="product_id" value={productId} />
                <input type="hidden" name="image_id" value={img.id} />
                <input type="hidden" name="dir" value="down" />
                <SubmitButton variant="secondary" className="!px-2 !py-1 text-xs">Later</SubmitButton>
              </ActionForm>
              <ActionForm action={deleteImage}>
                <input type="hidden" name="product_id" value={productId} />
                <input type="hidden" name="image_id" value={img.id} />
                <SubmitButton variant="danger" className="!px-2 !py-1 text-xs">Delete</SubmitButton>
              </ActionForm>
            </div>
          </li>
        ))}
      </ul>
      <ActionForm action={uploadImages} encType="multipart/form-data" className="space-y-3">
        <input type="hidden" name="product_id" value={productId} />
        <Field label="Add images (JPG, PNG, WebP; up to 5 MB each)">
          <input type="file" name="files" accept="image/jpeg,image/png,image/webp,image/avif" multiple className={inputCls} />
        </Field>
        <Field label="Description for screen readers (optional)">
          <input name="alt" className={inputCls} />
        </Field>
        <SubmitButton>Upload</SubmitButton>
      </ActionForm>
    </div>
  );
}
