import { notFound } from 'next/navigation';
import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { isUuid } from '@/lib/utils';
import { ActionForm, SubmitButton } from '@/components/admin/forms';
import { PageHeader, LinkButton } from '@/components/admin/ui';
import { ProductForm } from '@/components/admin/ProductForm';
import { VariantForm, type VariantData } from '@/components/admin/VariantForm';
import { ImageManager } from '@/components/admin/ImageManager';
import { archiveProduct } from '@/actions/admin/catalog';

export const metadata = { title: 'Edit product' };

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff('catalog.read');
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const db = adminClient();
  const { data: product } = await db.from('products').select('*').eq('id', id).maybeSingle();
  if (!product) notFound();

  const canWrite = can(staff.role, 'catalog.write');
  const canCosts = can(staff.role, 'costs.read');
  const canStock = can(staff.role, 'inventory.write');

  const [{ data: categories }, { data: variants }, { data: images }] = await Promise.all([
    db.from('categories').select('id, name').order('name'),
    db.from('product_variants').select('*, inventory(on_hand, reserved), variant_costs(cost_pesewas)').eq('product_id', id).order('created_at'),
    db.from('product_images').select('id, storage_path, alt_text').eq('product_id', id).order('sort_order').order('id'),
  ]);

  const rows: VariantData[] = (variants ?? []).map((v: any) => {
    const inv = Array.isArray(v.inventory) ? v.inventory[0] : v.inventory;
    const cost = Array.isArray(v.variant_costs) ? v.variant_costs[0] : v.variant_costs;
    return { ...v, on_hand: inv?.on_hand ?? 0, reserved: inv?.reserved ?? 0, cost_pesewas: canCosts ? (cost?.cost_pesewas ?? null) : undefined };
  });

  return (
    <>
      <PageHeader title={product.name as string} subtitle={`/products/${product.slug}`}>
        {product.status === 'active' ? <LinkButton href={`/products/${product.slug}`} variant="secondary">View in store</LinkButton> : null}
      </PageHeader>
      {canWrite ? (
        <ProductForm categories={categories ?? []} product={product as any} />
      ) : (
        <p className="rounded bg-zinc-100 p-3 text-sm text-zinc-600">You can view this product but not edit it.</p>
      )}

      <h2 className="mb-2 mt-8 text-lg font-semibold">Variants, prices and stock</h2>
      <p className="mb-3 text-sm text-zinc-500">Every product needs at least one variant. Customers buy variants, not products.</p>
      <div className="space-y-3">
        {rows.map((v) => (
          <VariantForm key={v.id} productId={id} variant={v} canCosts={canCosts} canStock={canStock} />
        ))}
        {canWrite ? (
          <details className="rounded-lg border border-dashed border-zinc-300 p-3" open={rows.length === 0}>
            <summary className="cursor-pointer text-sm font-medium text-emerald-800">Add a variant</summary>
            <div className="mt-3">
              <VariantForm productId={id} canCosts={canCosts} canStock={canStock} />
            </div>
          </details>
        ) : null}
      </div>

      {canWrite ? (
        <>
          <h2 className="mb-2 mt-8 text-lg font-semibold">Images</h2>
          <ImageManager productId={id} images={(images ?? []) as any} />
          {product.status !== 'archived' ? (
            <ActionForm action={archiveProduct} className="mt-8">
              <input type="hidden" name="id" value={id} />
              <SubmitButton variant="danger">Archive product</SubmitButton>
              <span className="ml-3 text-xs text-zinc-500">Hides it from the store. Order history is kept.</span>
            </ActionForm>
          ) : null}
        </>
      ) : null}
    </>
  );
}
