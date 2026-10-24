'use server';

import { adminClient } from '@/lib/supabase/admin';
import { requireStaff } from '@/lib/auth/session';
import { audit } from '@/lib/audit';
import { invalidateSettings } from '@/lib/settings';
import { SETTING_DEFS, DEFAULT_RATE_LIMITS } from '@/lib/settings-schema';
import { parseGhsToPesewas } from '@/lib/money';
import type { ActionState } from '@/lib/types';
import { done, fail, refreshAdmin } from './_util';

export async function saveSettings(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const staff = await requireStaff('settings.write');
  const db = adminClient();
  const upserts: Array<{ key: string; value: unknown }> = [];
  const deletes: string[] = [];

  for (const def of SETTING_DEFS) {
    const raw = fd.get(def.key);
    const text = typeof raw === 'string' ? raw.trim() : '';
    switch (def.kind) {
      case 'bool':
        upserts.push({ key: def.key, value: raw === 'on' });
        break;
      case 'int': {
        const n = Number(text);
        if (!text || !Number.isInteger(n) || n < 0) return fail(`${def.label}: enter a whole number.`);
        upserts.push({ key: def.key, value: n });
        break;
      }
      case 'pesewas': {
        if (!text) {
          deletes.push(def.key);
          break;
        }
        const p = parseGhsToPesewas(text);
        if (p === null) return fail(`${def.label}: enter an amount like 1500.00.`);
        upserts.push({ key: def.key, value: p });
        break;
      }
      case 'list':
        upserts.push({ key: def.key, value: text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) });
        break;
      case 'json': {
        if (!text) {
          deletes.push(def.key);
          break;
        }
        try {
          const parsed = JSON.parse(text);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
          for (const k of Object.keys(parsed)) if (!(k in DEFAULT_RATE_LIMITS)) return fail(`${def.label}: unknown rule "${k}".`);
          upserts.push({ key: def.key, value: parsed });
        } catch {
          return fail(`${def.label}: not valid JSON.`);
        }
        break;
      }
      default:
        if (!text && def.key === 'order_prefix') {
          deletes.push(def.key);
        } else {
          upserts.push({ key: def.key, value: text });
        }
    }
  }
  for (const p of upserts) {
    if (p.key === 'order_prefix' && !/^[A-Za-z0-9]{1,8}$/.test(String(p.value))) return fail('Order number prefix: 1 to 8 letters or numbers.');
    if (p.key === 'tax_rate_bps' && Number(p.value) > 10000) return fail('Tax rate cannot exceed 10000 (100%).');
  }

  const { error } = await db.from('store_settings').upsert(upserts, { onConflict: 'key' });
  if (error) return fail(error.message);
  if (deletes.length) await db.from('store_settings').delete().in('key', deletes);
  invalidateSettings();
  await audit({ actorId: staff.userId, action: 'settings.updated', entityType: 'settings', entityId: 'store', after: Object.fromEntries(upserts.map((u) => [u.key, u.value])) });
  refreshAdmin('/admin/settings');
  return done('Settings saved.');
}
