import { ActionForm, SubmitButton } from '@/components/admin/forms';
import { Field, inputCls } from '@/components/admin/ui';
import { saveProduct } from '@/actions/admin/catalog';

interface Props {
  categories: Array<{ id: string; name: string }>;
  product?: {
    id: string;
    name: string;
    slug: string;
    brand: string | null;
    category_id: string | null;
    description: string | null;
    size_guide: string | null;
    option_names: string[];
    status: string;
    featured: boolean;
    seo_title: string | null;
    seo_description: string | null;
  };
}

export function ProductForm({ categories, product }: Props) {
  return (
    <ActionForm action={saveProduct} className="space-y-4 rounded-lg border border-zinc-200 bg-white p-4">
      {product ? <input type="hidden" name="id" value={product.id} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <input name="name" defaultValue={product?.name} required className={inputCls} />
        </Field>
        <Field label="URL slug" hint="Leave empty to build it from the name.">
          <input name="slug" defaultValue={product?.slug} className={inputCls} />
        </Field>
        <Field label="Brand">
          <input name="brand" defaultValue={product?.brand ?? ''} className={inputCls} />
        </Field>
        <Field label="Category">
          <select name="category_id" defaultValue={product?.category_id ?? ''} className={inputCls}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Status" hint="Only Active products appear in the store.">
          <select name="status" defaultValue={product?.status ?? 'draft'} className={inputCls}>
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
          </select>
        </Field>
        <Field label="Option names" hint="Comma separated, e.g. size, color. Leave empty if there are no options.">
          <input name="option_names" defaultValue={product?.option_names.join(', ') ?? ''} className={inputCls} />
        </Field>
      </div>
      <Field label="Description">
        <textarea name="description" rows={5} defaultValue={product?.description ?? ''} className={inputCls} />
      </Field>
      <Field label="Size guide" hint="Optional. Shown on the product page.">
        <textarea name="size_guide" rows={3} defaultValue={product?.size_guide ?? ''} className={inputCls} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="SEO title">
          <input name="seo_title" defaultValue={product?.seo_title ?? ''} maxLength={70} className={inputCls} />
        </Field>
        <Field label="SEO description">
          <input name="seo_description" defaultValue={product?.seo_description ?? ''} maxLength={160} className={inputCls} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="featured" defaultChecked={product?.featured} /> Show on the home page as featured
      </label>
      <SubmitButton>{product ? 'Save product' : 'Create product'}</SubmitButton>
    </ActionForm>
  );
}
