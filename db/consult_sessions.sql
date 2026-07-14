-- pephouse Consult — consult_sessions
-- The spend meter for Tavus CVI. Tavus bills wall-clock replica minutes, has no
-- overage limit, and exposes NO credits/usage/quota endpoint — the backend cannot
-- ask the platform how many minutes remain. This table is therefore the only
-- meter that exists, and conversation-create is the only point at which a
-- refusal is possible. One row per minted conversation.
-- Append-only migration; source of truth for this table. Safe to re-run.

-- ── table ────────────────────────────────────────────────────────────────────
create table if not exists consult_sessions (
  id               bigint generated always as identity primary key,
  created_at       timestamptz not null default now(),
  user_ref         text not null,
  -- Tavus conversation id. Unique so a retry cannot double-count a session
  -- against the budget.
  conversation_id  text not null unique,
  -- The max_call_duration we sent to Tavus, in seconds. Budget accounting is
  -- worst-case against this value: without polling we never learn the true
  -- duration, so we charge every session at its ceiling. That under-allocates
  -- rather than overspends, which is the correct direction for a limit whose
  -- whole purpose is to make a surprise bill impossible.
  max_call_seconds int not null,
  status           text not null default 'active'
                     check (status in ('active', 'ended'))
);

comment on table consult_sessions is
  'Local spend meter for Tavus CVI minutes. Tavus has no usage API, so this is the only source of truth for how much we have committed this month.';

-- ── indexes ──────────────────────────────────────────────────────────────────
-- The budget guard reads the current month on every session create.
create index if not exists consult_sessions_created_at_idx
  on consult_sessions (created_at desc);

-- Per-user session caps.
create index if not exists consult_sessions_user_ref_idx
  on consult_sessions (user_ref);

-- ── row level security ───────────────────────────────────────────────────────
-- Spend data is operator-only. The backend reaches it with the service-role key.
-- No public/anon policies are defined; anon has no access.
alter table consult_sessions enable row level security;

do $$ begin
  create policy "service_role full access" on consult_sessions
    for all
    to service_role
    using (true)
    with check (true);
exception when duplicate_object then null; end $$;
