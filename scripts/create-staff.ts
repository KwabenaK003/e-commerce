/**
 * Creates (or promotes) a staff user.
 *   npm run create-staff -- you@example.com "A-strong-password" "Your Name" owner
 * Roles: owner | manager | support | fulfillment. Reads .env.local for the Supabase keys.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv('.env.local');
loadEnv('.env');

const [email, password, fullName = '', role = 'owner'] = process.argv.slice(2);
if (!email || !password || !['owner', 'manager', 'support', 'fulfillment'].includes(role)) {
  console.error('Usage: npm run create-staff -- <email> <password> "<Full Name>" <owner|manager|support|fulfillment>');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Use a password of at least 12 characters.');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local first.');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

async function main() {
  let userId: string | undefined;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
  if (created.error) {
    if (!/already|registered|exists/i.test(created.error.message)) throw created.error;
    const list = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
    userId = list.data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())?.id;
    if (!userId) throw new Error('User exists but could not be found.');
  } else {
    userId = created.data.user.id;
  }
  const { error } = await db.from('staff').upsert({ user_id: userId, role, full_name: fullName || null, is_active: true }, { onConflict: 'user_id' });
  if (error) throw error;
  console.log(`Done: ${email} is now ${role}. Sign in at /admin/login; you will be asked to set up two-factor on first use.`);
}
main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
