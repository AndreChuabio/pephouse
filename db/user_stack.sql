-- User's compound stack (Digital Twin "Add to my Stack").
-- One row per compound the user adds, with dose + source.
create table if not exists user_stack (
  id            bigint generated always as identity primary key,
  user_ref      text not null,
  -- compounds.id is bigint identity; match it (see trial_intakes).
  compound_id   bigint not null,
  compound_name text,
  dose          text,                  -- e.g. "7.5mg"
  source_type   text,                  -- label_dose | compounding_pharmacy | vendor_tested | gray_market
  created_at    timestamptz default now()
);
create index if not exists user_stack_user_ref_idx on user_stack(user_ref);
