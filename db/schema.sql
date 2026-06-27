-- pephouse / Team Wegovy — tiered evidence + data registry
-- Source of truth for the schema. Re-run in Supabase SQL Editor after edits.

-- Extensions
create extension if not exists vector;

-- Trust tier (enforces the "anecdote is never evidence" rule at the schema level)
do $$ begin
  create type data_tier as enum ('tier1_evidence', 'tier2_quality', 'tier3_anecdote', 'tier4_synthetic');
exception when duplicate_object then null; end $$;

-- SPINE: the compounds both doors revolve around
create table if not exists compounds (
  id            bigint generated always as identity primary key,
  name          text not null unique,
  aliases       text[] default '{}',
  drug_class    text,
  fda_status    text,                  -- 'approved', 'category_2_bulk', 'research_only'
  approved      boolean default false,
  summary       text,
  created_at    timestamptz default now()
);

-- TIER 1: citable evidence (grader cites this, twin priors come from this)
create table if not exists trials (
  id            bigint generated always as identity primary key,
  compound_id   bigint references compounds(id) on delete cascade,
  nct_id        text,
  phase         text,
  indication    text,
  status        text,
  n_enrolled    int,
  primary_endpoint text,
  efficacy_summary text,
  source_url    text,
  tier          data_tier default 'tier1_evidence'
);

-- nct_id is globally unique; lets trial ingestion be idempotent
create unique index if not exists trials_nct_id_key on trials (nct_id);

create table if not exists evidence_facts (
  id            bigint generated always as identity primary key,
  compound_id   bigint references compounds(id) on delete cascade,
  fact          text not null,
  source_url    text not null,         -- every fact MUST have a source
  embedding     vector(1536),          -- match your embedding model's dim
  tier          data_tier default 'tier1_evidence'
);

-- TIER 1 derived: the numbers that feed the twin's Monte Carlo
create table if not exists outcome_priors (
  id            bigint generated always as identity primary key,
  compound_id   bigint references compounds(id) on delete cascade,
  outcome_name  text not null,         -- 'weight_change_pct'
  effect_mean   numeric,
  effect_sd     numeric,
  unit          text,
  population_n  int,
  source_trial_id bigint references trials(id),
  tier          data_tier default 'tier1_evidence'
);

-- TIER 2: product/quality reality (Finnrick + vendor scrapes)
create table if not exists vendor_lab_results (
  id            bigint generated always as identity primary key,
  compound_id   bigint references compounds(id) on delete cascade,
  vendor_name   text,
  finnrick_rating text,
  purity_pct    numeric,
  label_mg      numeric,
  tested_mg     numeric,
  quantity_variance_pct numeric,
  batch_id      text,
  lab_id        text,
  test_date     date,
  source_url    text,
  tier          data_tier default 'tier2_quality'
);

-- TIER 3: anecdote/belief (seeds patient personas ONLY — never outcomes)
create table if not exists anecdotes (
  id            bigint generated always as identity primary key,
  compound_id   bigint references compounds(id) on delete cascade,
  source        text,                  -- 'reddit'
  permalink     text,
  body          text,
  claimed_effect text,
  sentiment     text,
  embedding     vector(1536),
  tier          data_tier default 'tier3_anecdote'
);

-- TIER 4: synthetic patient substrate (Synthea — no PHI)
create table if not exists synthetic_patients (
  id            bigint generated always as identity primary key,
  age           int,
  sex           text,
  weight_kg     numeric,
  conditions    jsonb default '[]',
  baseline_labs jsonb default '{}',
  tier          data_tier default 'tier4_synthetic'
);

-- RLS: public reference data, no PHI. Read open; writes via service_role key (bypasses RLS).
alter table compounds            enable row level security;
alter table trials               enable row level security;
alter table evidence_facts       enable row level security;
alter table outcome_priors       enable row level security;
alter table vendor_lab_results   enable row level security;
alter table anecdotes            enable row level security;
alter table synthetic_patients   enable row level security;

do $$ begin
  create policy "public read" on compounds          for select using (true);
  create policy "public read" on trials             for select using (true);
  create policy "public read" on evidence_facts     for select using (true);
  create policy "public read" on outcome_priors     for select using (true);
  create policy "public read" on vendor_lab_results for select using (true);
  create policy "public read" on anecdotes          for select using (true);
  create policy "public read" on synthetic_patients for select using (true);
exception when duplicate_object then null; end $$;
