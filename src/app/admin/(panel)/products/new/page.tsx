import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { PageHeader } from '@/components/admin/ui';
import { ProductForm } from '@/components/admin/ProductForm';

export const metadata = { title: 'New product' };

export default async function NewProductPage() {
  await requireStaff('catalog.write');
  const { data } = await adminClient().from('categories').select('id, name').order('name');
  return (
    <>
      <PageHeader title="New product" subtitle="Save the product first, then add variants (price and stock) and images." />
      <ProductForm categories={data ?? []} />
    </>
  );
}
