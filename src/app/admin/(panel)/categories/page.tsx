import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { can } from '@/lib/auth/permissions';
import { ActionForm, SubmitButton } from '@/components/admin/forms';
import { Field, PageHeader, inputCls } from '@/components/admin/ui';
import { saveCategory } from '@/actions/admin/catalog';

export const metadata = { title: 'Categories' };

export default async function CategoriesPage() {
  const staff = await requireStaff('catalog.read');
  const canWrite = can(staff.role, 'catalog.write');
  const { data } = await adminClient().from('categories').select('*').order('sort_order').order('name');
  const cats = data ?? [];
  const Row = ({ c }: { c?: any }) => (
    <ActionForm action={saveCategory} className="grid items-end gap-3 rounded-lg border border-zinc-200 bg-white p-3 md:grid-cols-6">
      {c ? <input type="hidden" name="id" value={c.id} /> : null}
      <Field label="Name"><input name="name" defaultValue={c?.name} required className={inputCls} /></Field>
      <Field label="Slug"><input name="slug" defaultValue={c?.slug} className={inputCls} /></Field>
      <Field label="Parent">
        <select name="parent_id" defaultValue={c?.parent_id ?? ''} className={inputCls}>
          <option value="">None (top level)</option>
          {cats.filter((x) => x.id !== c?.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
      <Field label="Order"><input name="sort_order" type="number" defaultValue={c?.sort_order ?? 0} className={inputCls} /></Field>
      {c ? <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="is_active" defaultChecked={c.is_active} /> Visible</label> : <span />}
      {canWrite ? <SubmitButton>{c ? 'Save' : 'Add category'}</SubmitButton> : null}
    </ActionForm>
  );
  return (
    <>
      <PageHeader title="Categories" subtitle="Hidden categories are removed from the store menu." />
      <div className="space-y-3">
        {cats.map((c) => <Row key={c.id} c={c} />)}
        {canWrite ? (
          <details className="rounded-lg border border-dashed border-zinc-300 p-3" open={cats.length === 0}>
            <summary className="cursor-pointer text-sm font-medium text-emerald-800">Add a category</summary>
            <div className="mt-3"><Row /></div>
          </details>
        ) : null}
      </div>
    </>
  );
}
