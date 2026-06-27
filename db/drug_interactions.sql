-- Drug interactions table for the Simulation 2 builder.
-- Live-only (not in schema.sql core); backend reads defensively, so it's safe
-- to apply this at any time without coordinated deploys.
--
-- Apply via Supabase SQL Editor. Rows are then populated by
--   python3 scripts/ingest_drug_interactions.py > interactions.sql
-- which pulls real openFDA Section-7 prose + curated peptide rows with
-- explicit citation URLs. No hardcoded inserts live here.

create table if not exists drug_interactions (
  id            bigint generated always as identity primary key,
  compound_a_id bigint references compounds(id) on delete cascade,
  compound_b_id bigint references compounds(id) on delete cascade,
  severity      text not null check (severity in ('major','moderate','minor','unknown')),
  mechanism     text,
  management    text,
  source_url    text,
  source_kind   text not null,  -- 'fda_label' | 'curated' | 'mechanistic'
  evidence_tier text default 'tier1_evidence',
  created_at    timestamptz default now(),
  unique (compound_a_id, compound_b_id, source_kind)
);

alter table drug_interactions enable row level security;

do $$ begin
  create policy "public read" on drug_interactions for select using (true);
exception when duplicate_object then null; end $$;
