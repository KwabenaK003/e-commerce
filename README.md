# E-commerce store (Next.js + Supabase + Paystack + Resend + Arkesel)

Built for Ghana: GHS pesewa money model, mobile money and cards through Paystack, SMS and email order updates.

## What works in this version

- Storefront: home, product list with search, product pages with variants, cart, guest checkout, order tracking, phone-number sign-in, account, returns request, policy pages
- Payments: Paystack hosted checkout, signed webhook, verify-before-paid, duplicate-safe, stuck-payment sweep, refunds, daily reconciliation
- Pay on delivery with staff confirmation, stock holds that expire, coupons, delivery zones, fraud flags
- Notifications: outbox with retries, email (Resend), SMS (Arkesel), big-sale alerts to owners
- Admin: sign-in with two-factor, dashboard, products and variants, images, categories
- Database: 11 migrations, row level security, 77 automated tests of the SQL rules (`npm run test:db`)

## Not built yet (next steps)

Admin pages for orders, returns and refunds, inventory, coupons, delivery zones, settings, notifications and audit log; bulk product import; invoice PDF route; Playwright e2e tests; CI file. The database functions behind all of these already exist and are tested.

## Run it locally

1. Install Node 20.9 or newer.
2. `npm install`
3. Create a free project at supabase.com. In the SQL editor, run every file in `supabase/migrations` in order (0001 to 0011), then `supabase/seed.sql` for sample products.
4. Copy `.env.example` to `.env.local` and fill in the Supabase URL, anon key and service role key, your Paystack **test** secret key, and `CRON_SECRET` (any long random string). Resend, Arkesel and Turnstile can stay empty in development: messages are logged to the terminal instead of sent.
5. Add `ADMIN_REQUIRE_MFA=false` to `.env.local` for local development only. Remove it in production.
6. `npm run dev`, open http://localhost:3000.
7. Create your first admin: `npm run create-staff -- you@example.com "StrongPassword123" "Your Name" owner`, then sign in at `/admin/login`.

## Phone sign-in (customers)

In Supabase: Authentication > Providers > enable Phone. Authentication > Hooks > enable "Send SMS" and point it to `https://YOUR-SITE/api/auth/sms-hook`. Copy the hook secret into `SEND_SMS_HOOK_SECRET`.

## Paystack webhook

In the Paystack dashboard set the webhook URL to `https://YOUR-SITE/api/paystack/webhook`. Locally, use a tunnel such as ngrok.

## Scheduled jobs

Run `supabase/cron.sql` in the Supabase SQL editor after replacing the two placeholders. It releases expired stock holds, sends queued notifications every minute, sweeps stuck payments, reconciles with Paystack daily and sends the low-stock digest.

## Checks

`npm run typecheck`, `npm run test:db`, `npm run build`.

## Before real launch

- Agree VAT and levies with your accountant, then set the tax settings.
- Have the policy pages (`/policies/*`) reviewed, and confirm Data Protection Commission registration requirements.
- Use Paystack live keys only after a full test-mode purchase, refund and webhook replay.
- Remove `ADMIN_REQUIRE_MFA=false`.
