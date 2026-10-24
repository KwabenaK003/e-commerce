import 'server-only';
import { adminClient } from '@/lib/supabase/admin';
import { listSuccessfulTransactions, verifyTransaction } from '@/lib/paystack';
import { alertOwners } from '@/lib/alerts';
import { formatGhsPlain } from '@/lib/money';
import { logger } from '@/lib/logger';

export interface Mismatch {
  kind: 'paystack_only' | 'database_only' | 'amount_differs' | 'status_differs';
  reference: string;
  paystackPesewas?: number;
  databasePesewas?: number;
  note?: string;
}

export interface ReconciliationResult {
  day: string;
  status: 'ok' | 'mismatch' | 'error';
  paystackTotal: number;
  databaseTotal: number;
  mismatches: Mismatch[];
}

/** Yesterday, as YYYY-MM-DD in UTC (Ghana is UTC+0 all year, so this is the Accra day too). */
export function yesterdayUtc(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  return d.toISOString().slice(0, 10);
}

/**
 * Daily check that Paystack and the database agree on what was paid.
 *  - every successful Paystack transaction must be a successful payment here, for the same amount
 *  - every payment marked successful here that Paystack did not list is verified individually
 * Mismatches are saved in reconciliation_runs and emailed to the owners.
 */
export async function reconcileDay(day: string): Promise<ReconciliationResult> {
  const db = adminClient();
  const from = new Date(`${day}T00:00:00.000Z`);
  const to = new Date(from.getTime() + 24 * 3600_000 - 1);
  const mismatches: Mismatch[] = [];

  try {
    const transactions = await listSuccessfulTransactions(from, to);
    const paystackRefs = new Map(transactions.map((t) => [t.reference, t]));
    const paystackTotal = transactions.reduce((s, t) => s + t.amount, 0);

    const refs = transactions.map((t) => t.reference);
    const known = new Map<string, { status: string; amount_pesewas: number }>();
    for (let i = 0; i < refs.length; i += 100) {
      const { data } = await db.from('payments').select('reference, status, amount_pesewas').in('reference', refs.slice(i, i + 100));
      for (const p of data ?? []) known.set(p.reference as string, { status: p.status as string, amount_pesewas: p.amount_pesewas as number });
    }
    for (const t of transactions) {
      const p = known.get(t.reference);
      if (!p) mismatches.push({ kind: 'paystack_only', reference: t.reference, paystackPesewas: t.amount, note: 'No payment with this reference in the database' });
      else if (p.status !== 'success') mismatches.push({ kind: 'status_differs', reference: t.reference, paystackPesewas: t.amount, note: `Database status is ${p.status}` });
      else if (p.amount_pesewas !== t.amount) mismatches.push({ kind: 'amount_differs', reference: t.reference, paystackPesewas: t.amount, databasePesewas: p.amount_pesewas });
    }

    const { data: dbPaid } = await db
      .from('payments')
      .select('reference, amount_pesewas')
      .eq('status', 'success')
      .gte('paid_at', from.toISOString())
      .lte('paid_at', to.toISOString());
    const databaseTotal = (dbPaid ?? []).reduce((s, p) => s + (p.amount_pesewas as number), 0);
    for (const p of (dbPaid ?? []).filter((x) => !paystackRefs.has(x.reference as string)).slice(0, 200)) {
      try {
        const tx = await verifyTransaction(p.reference as string);
        if (tx.status !== 'success') {
          mismatches.push({ kind: 'database_only', reference: p.reference as string, databasePesewas: p.amount_pesewas as number, note: `Paystack says ${tx.status}` });
        } else if (tx.amount !== p.amount_pesewas) {
          mismatches.push({ kind: 'amount_differs', reference: p.reference as string, paystackPesewas: tx.amount, databasePesewas: p.amount_pesewas as number });
        }
        // success on both sides but listed on a neighbouring day: fine
      } catch (e) {
        mismatches.push({ kind: 'database_only', reference: p.reference as string, databasePesewas: p.amount_pesewas as number, note: `Could not verify with Paystack: ${e instanceof Error ? e.message : 'error'}` });
      }
    }

    const status = mismatches.length ? 'mismatch' : 'ok';
    await db.from('reconciliation_runs').upsert(
      { run_date: day, paystack_total_pesewas: paystackTotal, database_total_pesewas: databaseTotal, mismatches, status },
      { onConflict: 'run_date' },
    );
    if (mismatches.length) {
      await alertOwners({
        title: `Payment reconciliation mismatch for ${day}`,
        lines: [
          `Paystack total ${formatGhsPlain(paystackTotal)}, database total ${formatGhsPlain(databaseTotal)}.`,
          ...mismatches.slice(0, 20).map((m) => `${m.kind}: ${m.reference}${m.note ? ` (${m.note})` : ''}`),
        ],
        dedupeKey: `reconcile:${day}`,
      });
    }
    return { day, status, paystackTotal, databaseTotal, mismatches };
  } catch (e) {
    logger.error('reconciliation failed', e, { day });
    await db.from('reconciliation_runs').upsert(
      { run_date: day, mismatches: [{ kind: 'error', reference: '-', note: e instanceof Error ? e.message : String(e) }], status: 'error' },
      { onConflict: 'run_date' },
    );
    await alertOwners({ title: `Payment reconciliation could not run for ${day}`, lines: [e instanceof Error ? e.message : String(e)], dedupeKey: `reconcile:${day}` });
    return { day, status: 'error', paystackTotal: 0, databaseTotal: 0, mismatches };
  }
}
