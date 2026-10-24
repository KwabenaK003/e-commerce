import Link from 'next/link';
import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { Badge, Empty, LinkButton, PageHeader, Pagination, Table, inputCls, pageNum, safeSearch, statusTone, tdCls, thCls } from '@/components/admin/ui';

export const metadata = { title: 'Products' };
const PAGE = 25;

export default async function ProductsPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const staff = await requireStaff('catalog.read');
  const sp = await searchParams;
  const page = pageNum(sp.page);
  const q = safeSearch(sp.q);
  let query = adminClient().from('products').select('id, name, slug, status, featured, brand, category:categories(name), variants:product_variants(id)', { count: 'exact' });
  if (q) query = query.or(`name.ilike.%${q}%,brand.ilike.%${q}%,slug.ilike.%${q}%`);
  if (sp.status && ['draft', 'active', 'archived'].includes(sp.status)) query = query.eq('status', sp.status);
  const { data, count } = await query.order('created_at', { ascending: false }).range((page - 1) * PAGE, page * PAGE - 1);

  return (
    <>
      <PageHeader title="Products" subtitle={`${count ?? 0} products`}>
        {can(staff.role, 'imports.write') ? <LinkButton href="/admin/import" variant="secondary">Bulk import</LinkButton> : null}
        {can(staff.role, 'catalog.write') ? <LinkButton href="/admin/products/new">Add product</LinkButton> : null}
      </PageHeader>
      <form className="mb-4 flex flex-wrap gap-2">
        <input name="q" defaultValue={q} placeholder="Search name, brand or slug" className={`${inputCls} max-w-xs`} />
        <select name="status" defaultValue={sp.status ?? ''} className={`${inputCls} max-w-[10rem]`}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="draft">Draft</option>
          <option value="archived">Archived</option>
        </select>
        <button className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm">Filter</button>
      </form>
      {!data?.length ? (
        <Empty>No products match.</Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={thCls}>Name</th>
              <th className={thCls}>Category</th>
              <th className={thCls}>Variants</th>
              <th className={thCls}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {data.map((p: any) => (
              <tr key={p.id}>
                <td className={tdCls}>
                  <Link href={`/admin/products/${p.id}`} className="font-medium text-emerald-800 hover:underline">{p.name}</Link>
                  <div className="text-xs text-zinc-500">{p.brand ?? ''} {p.featured ? '· featured' : ''}</div>
                </td>
                <td className={tdCls}>{(Array.isArray(p.category) ? p.category[0] : p.category)?.name ?? '-'}</td>
                <td className={tdCls}>{p.variants?.length ?? 0}</td>
                <td className={tdCls}><Badge tone={statusTone(p.status)}>{p.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <Pagination page={page} pageCount={Math.max(Math.ceil((count ?? 0) / PAGE), 1)} basePath="/admin/products" params={{ q, status: sp.status }} />
    </>
  );
}
