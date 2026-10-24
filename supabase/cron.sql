-- =====================================================================
-- Scheduled jobs using Supabase pg_cron + pg_net.
--
-- Run this ONCE in the Supabase SQL editor (staging and production),
-- after replacing the two placeholders below:
--   https://YOUR-SITE-URL   your deployed site, no trailing slash
--   YOUR-CRON-SECRET        the same value as the CRON_SECRET env var
--
-- Prerequisite: Database > Extensions > enable pg_cron and pg_net.
-- Re-running is safe: each job is unscheduled before it is created.
-- =====================================================================

-- SQL-only jobs (no HTTP needed) ---------------------------------------
select cron.unschedule(jobid) from cron.job
 where jobname in ('release-expired-holds', 'cancel-stale-cod', 'purge-rate-limits',
                   'send-notifications', 'payment-sweep', 'reconcile-paystack', 'low-stock-digest');

select cron.schedule('release-expired-holds', '* * * * *',
  $$select release_expired_reservations()$$);

select cron.schedule('cancel-stale-cod', '7 * * * *',
  $$select cancel_stale_cod(24)$$);

select cron.schedule('purge-rate-limits', '*/30 * * * *',
  $$select purge_expired_rate_limits()$$);

-- HTTP jobs (call the Next.js job endpoints with the shared secret) -----
select cron.schedule('send-notifications', '* * * * *', $$
  select net.http_post(
    url := 'https://YOUR-SITE-URL/api/jobs/send-notifications',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR-CRON-SECRET'),
    timeout_milliseconds := 25000)
$$);

select cron.schedule('payment-sweep', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-SITE-URL/api/jobs/payment-sweep',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR-CRON-SECRET'),
    timeout_milliseconds := 25000)
$$);

-- 06:00 UTC (= 06:00 in Accra)
select cron.schedule('reconcile-paystack', '0 6 * * *', $$
  select net.http_post(
    url := 'https://YOUR-SITE-URL/api/jobs/reconcile',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR-CRON-SECRET'),
    timeout_milliseconds := 55000)
$$);

select cron.schedule('low-stock-digest', '0 8 * * *', $$
  select net.http_post(
    url := 'https://YOUR-SITE-URL/api/jobs/low-stock-digest',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR-CRON-SECRET'),
    timeout_milliseconds := 25000)
$$);
