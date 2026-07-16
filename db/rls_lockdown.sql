-- pephouse — RLS lockdown on the member-data tables.
--
-- These five tables hold health data, and every one of them was reachable
-- directly from the browser. The frontend ships the Supabase publishable
-- (anon) key by design, the `anon` role held full SELECT/INSERT/UPDATE/DELETE
-- on each table, and RLS was OFF — so anyone could read or delete every user's
-- profile, labs, wearable stream, stack, and trial intake by calling the
-- Supabase REST API directly, entirely bypassing the application's auth layer.
--
-- The fix is RLS on, with access limited to the service_role. The backend
-- reaches these tables server-side with the SECRET key (service_role, which
-- bypasses RLS); the browser's anon key is denied. This is the same posture the
-- other sensitive tables (entitlements, consult_sessions, vendor_submissions)
-- already have.
--
-- PREREQUISITE: the backend MUST use the Supabase SECRET key (sb_secret_...),
-- not the publishable key. With RLS on, an anon-key backend loses access to
-- these tables. See backend/.env — SUPABASE_SERVICE_ROLE_KEY must be the secret.
--
-- Append-only migration. Safe to re-run.

do $$
declare
  t text;
begin
  foreach t in array array[
    'user_profiles',
    'user_lab_results',
    'user_wearable_metrics',
    'user_stack',
    'trial_intakes'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    -- Revoke the blanket grants that made the tables readable by the browser
    -- key. Access now comes solely through the service_role policy below.
    execute format('revoke all on public.%I from anon, authenticated', t);

    -- service_role bypasses RLS regardless, but the explicit policy documents
    -- intent and matches the convention used by the other sensitive tables.
    begin
      execute format(
        'create policy "service_role full access" on public.%I for all to service_role using (true) with check (true)',
        t
      );
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
