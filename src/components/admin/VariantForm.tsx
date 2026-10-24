import { ActionForm, SubmitButton } from '@/components/admin/forms';
import { Field, inputCls } from '@/components/admin/ui';
import { saveVariant } from '@/actions/admin/catalog';
import { pesewasToInput } from '@/lib/money';

export interface VariantData {
  id: string;
  sku: string;
  name: string | null;
  option_values: Record<string, string>;
  price_pesewas: number;
  compare_at_pesewas: number | null;
  is_active: boolean;
  on_hand?: number;
  reserved?: number;
  cost_pesewas?: number | null;
}

/** One form per variant (or a blank one to add a variant). Cost and stock fields appear only if the role may use them. */
export function VariantForm({ productId, variant, canCosts, canStock }: { productId: string; variant?: VariantData; canCosts: boolean; canStock: boolean }) {
  const optionText = variant ? Object.entries(variant.option_values).map(([k, v]) => `${k}=${v}`).join('; ') : '';
  return (
    <ActionForm action={saveVariant} className="rounded-lg border border-zinc-200 bg-white p-3">
      <input type="hidden" name="product_id" value={productId} />
      {variant ? <input type="hidden" name="variant_id" value={variant.id} /> : null}
      <div className="grid gap-3 md:grid-cols-4">
        <Field label="SKU">
          <input name="sku" defaultValue={variant?.sku} required className={inputCls} />
        </Field>
        <Field label="Variant name" hint="e.g. Black / M">
          <input name="name" defaultValue={variant?.name ?? ''} className={inputCls} />
        </Field>
        <Field label="Options" hint="size=M; color=Black">
          <input name="option_values" defaultValue={optionText} className={inputCls} />
        </Field>
        <Field label="Price (GHS)">
          <input name="price" defaultValue={variant ? pesewasToInput(variant.price_pesewas) : ''} required inputMode="decimal" className={inputCls} />
        </Field>
        <Field label="Compare-at (GHS)" hint="Higher price shown struck out">
          <input name="compare_at" defaultValue={variant ? pesewasToInput(variant.compare_at_pesewas) : ''} inputMode="decimal" className={inputCls} />
        </Field>
        {canCosts ? (
          <Field label="Cost (GHS)" hint="Staff only">
            <input name="cost" defaultValue={variant ? pesewasToInput(variant.cost_pesewas ?? null) : ''} inputMode="decimal" className={inputCls} />
          </Field>
        ) : null}
        {canStock ? (
          <Field label="Stock on hand" hint={variant ? `${variant.reserved ?? 0} held for unpaid orders` : undefined}>
            <input name="stock" type="number" min={0} defaultValue={variant?.on_hand ?? 0} className={inputCls} />
          </Field>
        ) : null}
        {variant ? (
          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" name="is_active" defaultChecked={variant.is_active} /> Active
          </label>
        ) : null}
      </div>
      <div className="mt-3">
        <SubmitButton>{variant ? 'Save variant' : 'Add variant'}</SubmitButton>
      </div>
    </ActionForm>
  );
}
