-- Drug interactions table for the Simulation 2 builder.
-- Live-only (not in schema.sql core); the backend reads defensively, so the
-- table can stay empty while the live DrugBank-via-PubChem lookup carries
-- the load. Curated peptide-specific rows can be inserted by hand later.
-- Apply once via Supabase SQL Editor.

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
