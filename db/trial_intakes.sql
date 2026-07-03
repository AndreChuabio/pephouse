-- pephouse Consult — trial_intakes
-- Captures a user's clinical-trial intake after the CVI consult: what they were
-- counseled on, the eligibility read, and a minimized context snapshot a
-- coordinator can act on. Append-only migration; source of truth for this table.
-- Re-run in the Supabase SQL Editor after edits (safe to re-run).

-- ── table ────────────────────────────────────────────────────────────────────
create table if not exists trial_intakes (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  user_ref           text not null,
  goal               text,
  -- compounds.id is bigint identity; match it (all sibling FKs in schema.sql are
  -- bigint). ON DELETE SET NULL: retiring a compound from the registry must not
  -- destroy or block a patient intake record (compound_name is denormalized).
  compound_id        bigint references compounds(id) on delete set null,
  compound_name      text,
  eligibility        text check (eligibility in ('eligible', 'excluded', 'no_trial', 'unknown')),
  eligibility_reason text,
  context_snapshot   jsonb,
  counsel_summary    text,
  consent            boolean not null default false,
  status             text not null default 'submitted'
                       check (status in ('submitted', 'reviewed', 'contacted', 'closed'))
);

-- context_snapshot holds ONLY what a trial coordinator needs to triage this
-- intake (goal, eligibility inputs, high-level markers). PHI minimization: do
-- not persist raw bloodwork, wearable streams, identifiers, or contact details
-- here. Keep it to the minimum a coordinator needs to act.
comment on column trial_intakes.context_snapshot is
  'PHI minimization: stores only the minimized context a trial coordinator needs to triage the intake. No raw PHI, identifiers, or contact details.';

-- ── indexes ──────────────────────────────────────────────────────────────────
-- Coordinator queue: newest open intakes first, filtered by status.
create index if not exists trial_intakes_status_created_idx
  on trial_intakes (status, created_at desc);

-- Per-user lookup (one browser user_ref may submit multiple intakes).
create index if not exists trial_intakes_user_ref_idx
  on trial_intakes (user_ref);

-- ── row level security ───────────────────────────────────────────────────────
-- This table can carry sensitive intent, so it is NOT public-readable (unlike
-- the reference tables in schema.sql). The backend reaches it with the
-- service-role key. No public/anon policies are defined; anon has no access.
alter table trial_intakes enable row level security;

do $$ begin
  create policy "service_role full access" on trial_intakes
    for all
    to service_role
    using (true)
    with check (true);
exception when duplicate_object then null; end $$;
