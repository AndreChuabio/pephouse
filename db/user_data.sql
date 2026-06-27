-- pephouse — user-connected / -reported health data
-- Mirrors the Junction (Vital) import shape so a live Junction pull and a mock
-- row are interchangeable downstream (see backend/junction.py ProfilePatch).
--
-- Source of truth for these tables. Re-run in the Supabase SQL Editor after edits.
-- Safe to re-run: drops+reseeds the demo rows but leaves real user rows alone.

-- ── tables ────────────────────────────────────────────────────────────────

-- Derived patient patch the twin consumes (one row per browser `user_ref`).
-- Wearable import fills age/sex/weight; bloodwork import fills conditions.
create table if not exists user_profiles (
  user_ref     text primary key,
  age          int,
  sex          text,                  -- M | F
  weight_kg    numeric,
  conditions   text[] default '{}',
  source_kind  text,                  -- device | bloodwork | upload
  source_label text,
  connected    boolean default false,
  updated_at   timestamptz default now()
);

-- Wearable daily summaries (mirrors Junction /v2/summary activity + sleep + body).
create table if not exists user_wearable_metrics (
  id            bigint generated always as identity primary key,
  user_ref      text references user_profiles(user_ref) on delete cascade,
  calendar_date date not null,
  steps         int,
  resting_hr    int,
  hrv_ms        numeric,
  sleep_hours   numeric,
  calories      int,
  weight_kg     numeric,
  provider      text,                 -- 'oura' | 'fitbit' | 'apple_health' ...
  unique (user_ref, calendar_date)
);

create index if not exists user_wearable_user_idx on user_wearable_metrics(user_ref);

-- Bloodwork biomarkers (mirrors Junction /v3/order/{id}/result -> parse_labs()).
create table if not exists user_lab_results (
  id           bigint generated always as identity primary key,
  user_ref     text references user_profiles(user_ref) on delete cascade,
  name         text not null,
  slug         text,
  value        text,                  -- numeric or string biomarker value
  unit         text,
  flag         text,
  status       text,                  -- optimal | high | low | abnormal
  ref_low      numeric,
  ref_high     numeric,
  collected_at timestamptz default now(),
  source_kind  text,                  -- bloodwork
  source_label text
);

create index if not exists user_lab_results_user_idx on user_lab_results(user_ref);

-- ── mock seed (demo user) ───────────────────────────────────────────────────
-- A prediabetic, hyperlipidemic 54yo M — exercises the twin's condition rules
-- (HbA1c >= 5.7 -> prediabetes, LDL >= 160 -> hyperlipidemia).

delete from user_lab_results     where user_ref = 'demo-user';
delete from user_wearable_metrics where user_ref = 'demo-user';
delete from user_profiles         where user_ref = 'demo-user';

insert into user_profiles (user_ref, age, sex, weight_kg, conditions, source_kind, source_label, connected)
values ('demo-user', 54, 'M', 92.5, '{prediabetes,hyperlipidemia}', 'bloodwork', 'Bloodwork · 6 biomarkers', true);

-- 14 days of wearable summaries (deterministic mock; gentle variation).
insert into user_wearable_metrics (user_ref, calendar_date, steps, resting_hr, hrv_ms, sleep_hours, calories, weight_kg, provider)
select
  'demo-user',
  (current_date - g)::date,
  6000 + (g * 137 % 4000),
  58 + (g % 5),
  42 + (g % 11),
  6.2 + ((g % 4) * 0.4),
  2100 + (g * 53 % 600),
  92.5 + ((g % 3) * 0.2),
  'oura'
from generate_series(0, 13) as g;

insert into user_lab_results (user_ref, name, slug, value, unit, flag, status, ref_low, ref_high, source_kind, source_label) values
  ('demo-user', 'Hemoglobin A1c',      'hba1c',       '5.9',  '%',      'High',   'high',    4.0,  5.6,  'bloodwork', 'Quest sandbox panel'),
  ('demo-user', 'LDL Cholesterol',     'ldl',         '165',  'mg/dL',  'High',   'high',    0,    100,  'bloodwork', 'Quest sandbox panel'),
  ('demo-user', 'HDL Cholesterol',     'hdl',         '41',   'mg/dL',  'Low',    'low',     40,   60,   'bloodwork', 'Quest sandbox panel'),
  ('demo-user', 'Fasting Glucose',     'glucose',     '110',  'mg/dL',  'High',   'high',    70,   99,   'bloodwork', 'Quest sandbox panel'),
  ('demo-user', 'Triglycerides',       'triglycerides','180', 'mg/dL',  'High',   'high',    0,    150,  'bloodwork', 'Quest sandbox panel'),
  ('demo-user', 'eGFR',                'egfr',        '88',   'mL/min', 'Normal', 'optimal', 90,   null, 'bloodwork', 'Quest sandbox panel');
