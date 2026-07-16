-- pephouse — entitlements: what a member has paid for.
--
-- One row per completed purchase. Access is a row, not a flag on the user, so a
-- refund or a dispute is expressed by revoking a row rather than by mutating a
-- shared boolean and losing the history of why.
--
-- Idempotency is the whole job here. Stripe delivers webhooks at least once, and
-- the return-from-checkout path can confirm the same payment a second time, so a
-- member must never be granted twice or charged twice for one session. Both
-- `stripe_session_id` and `stripe_event_id` are unique, and every write is an
-- upsert on the session id.
--
-- Append-only migration; source of truth for this table. Safe to re-run.

create table if not exists entitlements (
  id                bigint generated always as identity primary key,
  created_at        timestamptz not null default now(),

  -- The Supabase user id. A durable (non-anonymous) account is required to buy,
  -- because an anonymous session that is lost would take its entitlement with it.
  user_ref          text not null,
  email             text,

  -- What was bought. One product today; the column keeps the door open.
  product           text not null default 'stack_report'
                      check (product in ('stack_report')),

  status            text not null default 'active'
                      check (status in ('active', 'refunded', 'revoked')),

  -- Null means it does not expire.
  expires_at        timestamptz,

  -- Stripe provenance. Unique so a replayed webhook or a double-confirmed
  -- return cannot mint a second grant for one payment.
  stripe_session_id text unique,
  stripe_event_id   text unique,
  amount_cents      integer,
  currency          text
);

comment on table entitlements is
  'One row per completed purchase. Unique stripe_session_id and stripe_event_id make webhook replay and double-confirmation harmless.';

create index if not exists entitlements_user_active_idx
  on entitlements (user_ref, status, expires_at);

-- ── row level security ───────────────────────────────────────────────────────
-- Purchase records are read through the backend, which resolves the member from
-- their verified token. Anon has no direct access.
alter table entitlements enable row level security;

do $$ begin
  create policy "service_role full access" on entitlements
    for all
    to service_role
    using (true)
    with check (true);
exception when duplicate_object then null; end $$;
