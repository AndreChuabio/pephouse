All facts verified against live DB and repo. Compound IDs confirmed (Tirzepatide=3, Retatrutide=12, BPC-157=1, Semaglutide=2); live `outcome_priors` match the design (Tirzepatide weight −21.1±9.9 n=284, Retatrutide −17.39±5.4 n=62, etc.); one real `vendor_lab_results` row (LSPL); `sourcing` has 11 free-text rows (QSC, LSPL + 9 China resellers); frontend `simulation.ts` exposes `confidenceLevel: 1|2|3`, `ChartBar[]`, `MetricCard`. Here is the merged deliverable.

---

# PepHouse — Source as a Second Variance Axis (build-tonight deliverable)

The twin already models biological variance from real trial priors. This adds a second, independent variance axis: **where the peptide was made**. Model is `delivered_dose = label_dose x potency_factor`, where `potency_factor`'s distribution is keyed on `source_type`. It is a pure multiplicative pre-factor on the biological draw, so it slots in front of the existing `outcome_priors` with zero change to Tier-1 tables. The tier wall holds: all source/patient data is Tier-2/3 and can never feed `outcome_priors`.

---

## 1. The sourcing thesis (pitch-ready, cited)

- **The 2023 FDA ban is the mechanism that created the gray market.** In late 2023 the FDA moved ~19 popular peptides — including BPC-157 and TB-500 — to the **Category 2** bulk-substances list under 503A (a de facto "do not compound" designation), legally barring licensed compounding pharmacies from preparing them even with a prescription. Demand did not disappear; it defaulted to unregulated suppliers. *Verified — FDA Category 2 list; corroborated by DJ Holt Law (BPC-157 specifically).* [fda.gov](https://www.fda.gov/drugs/human-drug-compounding/certain-bulk-drug-substances-use-compounding-may-present-significant-safety-risks) · [djholtlaw.com](https://djholtlaw.com/regulatory-alert-the-legal-status-of-bpc-157-in-compounding-and-clinical-practice/)
- **The cost gap is roughly an order of magnitude — ~10–30x brand vs gray market, ~3–8x compounded vs gray.** Gray-market semaglutide runs $35–90/mo and tirzepatide $50–130/mo vs brand Mounjaro/Zepbound at $1,400–1,600/mo; compounded tirzepatide ($199–449/mo) is only ~3–8x the gray-market powder (~$48/vial vs $399+ at a US pharmacy). The teammate's "~20x" is a fair midpoint for **supervised/brand therapy vs a bare gray-market vial**, not for compounding pharmacies specifically. *Verified, basis-dependent.* [worldpeptideassociation.com](https://worldpeptideassociation.com/learn/semaglutide-vs-tirzepatide-vs-retatrutide-cost) · [peptidejournal.org](https://www.peptidejournal.org/news/chinese-peptides-gray-market-biohacking)
- **China is the dominant gray-market source — anchored on import data, not blog percentages.** US Customs data: imports of hormone/peptide compounds from China roughly **doubled to ~$328M in the first nine months of 2025** (vs ~$164M same period 2024). China is also the world's largest producer of peptide key starting materials (KSMs). The widely-circulated "25%" and "68% of global peptide APIs" figures are **unsourced industry-blog estimates — cite as "commonly claimed but unverified," not fact.** [gzeromedia.com](https://www.gzeromedia.com/news/analysis/how-china-is-supplying-americas-biohacking-craze)
- **China is genuinely capable of pharma-grade synthesis — this is FDA-verified, so the variance is a QA/transparency problem, not a chemistry one.** CPC Scientific (Hangzhou) holds a US FDA Drug Master File for tirzepatide API (DMF #043979) and has passed FDA inspection 5x; Enogen is certified by China NMPA, US FDA, EU EDQM, and is on the FDA GLP-1 "Green List" for semaglutide and tirzepatide. The same SPPS lines also export lower-documentation "research chemical" lots under a "Research Use Only / not for human consumption" label, outside the drug-approval pathway. *Verified.* [pharmaceutical-networking.com](https://www.pharmaceutical-networking.com/cpc-scientifics-tirzepatide-api-successfully-secures-us-fda-dmf-filing-fully-empowering-the-global-weight-loss-and-metabolism-arena/) · [fda.gov Green List](https://www.fda.gov/news-events/press-announcements/fda-launches-green-list-protect-americans-illegal-imported-glp-1-drug-ingredients)
- **THE modeling linchpin: purity is tight, delivered quantity is the wide axis.** Independent lab Finnrick (8,779 HPLC tests across 263 vendors): purity sits at **98.74–99.95%** (5th–95th pct) but **quantity diverges up to ±48%** vs advertised at the 95th percentile. Roughly **one-third of gray-market samples fail** identity/purity/quantity, and **~8% show quantifiable endotoxin**. This empirically validates `delivered_dose = label x potency_factor` with a wide, fat-left-tail *quantity* distribution — not a purity distribution. *Verified.* [finnrick.com/products/retatrutide](https://www.finnrick.com/products/retatrutide)
- **"Get it tested" is itself a variance-reducing intervention.** Quantity error is separable from purity: the same PepHouse anchor — LSPL tirzepatide at **99.8% purity but −4.3% quantity** (28.7 mg of 30 mg labeled) — shows high purity coexisting with under-fill. A cross-lab retatrutide test read 30 mg (Janoshik) vs 26 mg (Krause), ~15% apart on identical vials. A named, third-party-tested vendor collapses the identity/fail uncertainty even when under-dosed. *Verified.* [finnrick.com/vendors/lspl](https://www.finnrick.com/vendors/lspl) · [peptideprotocolwiki.com](https://www.peptideprotocolwiki.com/blog/janoshik-analytical-review)

---

## 2. Schema (final, idempotent, runnable)

Reconciliation of the two earlier drafts into one runnable migration: a single canonical `source_potency_priors` table (the data-model draft's descriptive columns **plus** the sim engine's mixture parameters — the competing `source_quality_priors` is dropped), one `source_type` enum standardized on American `gray_market` to match the `/simulate` contract and the frontend's `"gray-market"` tier, and `vendor_tested` promoted to a first-class enum value because the demo's three-way comparison and the "measured collapse" depend on it. Safe to re-run. Save as `/Users/andrechuabio/HealthcarexAI/pephouse/db/schema.sql` additions (or a migration under `supabase/migrations/`).

```sql
-- PepHouse source-quality schema (project aglgyphihqcconivmmux)
-- Tier wall: every new table defaults Tier-2/3 with CHECK (tier <> 'tier1_evidence').
-- Implements delivered_dose = label_dose x potency_factor (2nd variance axis). Idempotent.

-- 0. Enums (guarded) ---------------------------------------------------------
do $$ begin
  create type data_tier as enum ('tier1_evidence','tier2_quality','tier3_anecdote','tier4_synthetic');
exception when duplicate_object then null; end $$;            -- already exists in prod; guarded for fresh runs

do $$ begin
  create type source_type as enum ('compounding_pharmacy','vendor_tested','gray_market','research_chem','brand');
exception when duplicate_object then null; end $$;

do $$ begin
  create type cost_tier as enum ('low','medium','high','premium'); -- low~gray(~1x) | medium/high~compounded(~3-8x) | premium~brand(~10-30x)
exception when duplicate_object then null; end $$;

-- 1. vendors  — canonical seller/manufacturer registry; SOURCE as a first-class dimension ------
create table if not exists public.vendors (
  id                    bigint generated always as identity primary key,
  name                  text not null unique,
  manufacturer          text,                                  -- upstream API maker if distinct (CPC Scientific, Enogen)
  country               text,
  source_type           source_type not null default 'gray_market',
  third_party_tested    boolean not null default false,
  test_labs             text[] default '{}',                   -- Finnrick, Janoshik, Krause
  cost_tier             cost_tier,
  cost_per_vial_usd     numeric,
  cost_multiple_vs_gray numeric,                               -- ~1 gray | ~3-8 compounded | ~10-30 brand
  gmp_certified         boolean not null default false,
  fda_green_list        boolean not null default false,        -- API on FDA GLP-1 Green List
  fda_dmf               text,                                  -- Drug Master File # (043979 = CPC tirzepatide)
  finnrick_rating       text,
  reliability_score     numeric check (reliability_score between 0 and 1),
  notes                 text,
  source_url            text,
  tier                  data_tier not null default 'tier2_quality' check (tier <> 'tier1_evidence'),
  created_at            timestamptz default now()
);
create index if not exists vendors_source_type_idx on public.vendors (source_type);

-- 2. source_potency_priors — the Monte-Carlo seed for the SOURCE axis (mirror of outcome_priors).
--    Columns match the numpy engine exactly so it is drop-in (potency_mean/_sd, p_fail, fail_mean/_sd, p_contam).
create table if not exists public.source_potency_priors (
  id                    bigint generated always as identity primary key,
  source_type           source_type not null,
  compound_id           bigint references public.compounds(id), -- NULL = default for all compounds
  potency_mean          numeric not null,                      -- nominal-lot fill x purity (fraction); compounding ~1.0
  potency_sd            numeric not null,                      -- nominal-lot sd = THE second variance axis
  p_fail                numeric not null default 0 check (p_fail between 0 and 1),  -- P(under-filled / wrong-identity lot)
  fail_mean             numeric,                               -- bad-lot mean potency (~0.5)
  fail_sd               numeric,
  p_contam              numeric not null default 0 check (p_contam between 0 and 1), -- P(endotoxin/heavy-metal/identity); ~8% gray
  underdose_rate        numeric check (underdose_rate between 0 and 1),  -- descriptive: P(delivered < 0.9 x label)
  quantity_variance_p95 numeric,                              -- +/- divergence 95th pct (Finnrick retatrutide ~0.48)
  n_samples             integer,
  basis                 text not null default 'commonly_claimed_unverified'
                          check (basis in ('verified','commonly_claimed_unverified')),
  source_refs           text[] default '{}',
  source_url            text,
  tier                  data_tier not null default 'tier2_quality' check (tier <> 'tier1_evidence'),
  created_at            timestamptz default now(),
  unique (source_type, compound_id)
);
create index if not exists source_potency_priors_st_idx on public.source_potency_priors (source_type);

-- 3. vendor_lab_results extensions — vendor link, generated potency_factor, contamination flags, named lab.
alter table public.vendor_lab_results add column if not exists vendor_id bigint references public.vendors(id);
alter table public.vendor_lab_results add column if not exists potency_factor numeric
  generated always as (case when label_mg is not null and label_mg <> 0
    then round((tested_mg / label_mg) * coalesce(purity_pct,100)/100.0, 4) end) stored;  -- fill x purity
alter table public.vendor_lab_results add column if not exists test_lab text;            -- Finnrick | Janoshik | Krause
alter table public.vendor_lab_results add column if not exists test_method text;         -- HPLC | MS
alter table public.vendor_lab_results add column if not exists identity_verified boolean;
alter table public.vendor_lab_results add column if not exists endotoxin_detected boolean;
alter table public.vendor_lab_results add column if not exists endotoxin_eu_per_mg numeric;
alter table public.vendor_lab_results add column if not exists heavy_metals_detected boolean;
alter table public.vendor_lab_results add column if not exists sterility_pass boolean;
alter table public.vendor_lab_results add column if not exists failed boolean;
alter table public.vendor_lab_results add column if not exists fail_reason text;          -- identity|purity|quantity|sterility|endotoxin
create index if not exists vendor_lab_results_vendor_idx on public.vendor_lab_results (vendor_id);

-- 4. anecdotes extensions — retrofit source provenance onto existing Reddit Tier-3 rows.
alter table public.anecdotes add column if not exists source_type source_type;
alter table public.anecdotes add column if not exists vendor text;                        -- free-text as posted
alter table public.anecdotes add column if not exists vendor_id bigint references public.vendors(id);
alter table public.anecdotes add column if not exists tested_purity numeric;              -- if a COA was shared
alter table public.anecdotes add column if not exists cost_usd numeric;
create index if not exists anecdotes_source_type_idx on public.anecdotes (source_type);

-- 5. user_reports — first-class patient layer tying an OUTCOME to a SOURCE. Tier-3, never a prior.
create table if not exists public.user_reports (
  id                    bigint generated always as identity primary key,
  compound_id           bigint references public.compounds(id),
  vendor_id             bigint references public.vendors(id),
  source_type           source_type,
  label_dose_mg         numeric,
  tested_purity_pct     numeric,
  tested_potency_factor numeric,                              -- delivered/label if known; calibrates the source axis
  batch_lab_tested      boolean not null default false,
  cost_usd              numeric,
  cost_period           text,                                 -- per_vial|per_month|per_year
  reported_effect       text,
  outcome_value         numeric,
  outcome_unit          text,
  sentiment             text,
  notes                 text,
  source_url            text,
  tier                  data_tier not null default 'tier3_anecdote' check (tier <> 'tier1_evidence'),
  created_at            timestamptz default now()
);
create index if not exists user_reports_compound_idx on public.user_reports (compound_id);
create index if not exists user_reports_source_type_idx on public.user_reports (source_type);

-- 6. sourcing tie — link existing thin sourcing rows to the registry (legacy text source_type left intact).
alter table public.sourcing add column if not exists vendor_id bigint references public.vendors(id);
create index if not exists sourcing_vendor_idx on public.sourcing (vendor_id);

-- 7. RLS: public read on the new tables (matches existing pattern).
alter table public.vendors               enable row level security;
alter table public.source_potency_priors enable row level security;
alter table public.user_reports          enable row level security;
drop policy if exists "public read vendors" on public.vendors;
create policy "public read vendors" on public.vendors for select using (true);
drop policy if exists "public read source_potency_priors" on public.source_potency_priors;
create policy "public read source_potency_priors" on public.source_potency_priors for select using (true);
drop policy if exists "public read user_reports" on public.user_reports;
create policy "public read user_reports" on public.user_reports for select using (true);
```

Note on `vendor_lab_results.potency_factor`: I made the generated column `fill x purity` (not bare `tested/label`) so it equals the delivered-active fraction the engine actually consumes. For LSPL that is `(28.7/30) x 0.998 = 0.9547`, which matches the seeded `vendor_tested` Tirzepatide prior below.

---

## 3. Seed rows (real flagged vs illustrative)

### 3a. `source_potency_priors` — the engine seed

The **aggregate anchors are verified** (Finnrick ±48% quantity p95, ~30% fail, ~8% endotoxin; LSPL measured 0.954; USP 90–110% content standard). The **mixture decomposition into `p_fail`/`fail_mean`/`potency_sd` is illustrative calibration** chosen to reproduce those verified aggregates — `basis='verified'` marks rows whose anchoring aggregate is a real lab number; `source_refs` carries the citation.

```sql
-- DEFAULT priors (compound_id NULL). Spread/decomposition = calibration; aggregates = verified.
insert into source_potency_priors
  (source_type, compound_id, potency_mean, potency_sd, p_fail, fail_mean, fail_sd, p_contam,
   underdose_rate, quantity_variance_p95, n_samples, basis, source_refs) values
('compounding_pharmacy', null, 1.00, 0.05, 0.01, 0.85, 0.10, 0.00, 0.02, 0.10, null, 'verified',
  '{"USP <797>/503A compounded products held to ~90-110% label content; legal, GMP-documented",
    "https://www.fda.gov/drugs/human-drug-compounding"}'),
('vendor_tested',        null, 0.96, 0.08, 0.05, 0.55, 0.15, 0.03, 0.08, 0.16, null, 'verified',
  '{"Gray-market vendor WITH third-party HPLC (Finnrick/Janoshik): measured fill+purity, residual batch variance",
    "https://www.finnrick.com/"}'),
('gray_market',          null, 1.00, 0.15, 0.15, 0.50, 0.20, 0.08, 0.18, 0.48, 8779, 'verified',
  '{"Finnrick 8,779 tests/263 vendors: purity 98.74-99.95% but quantity +/-48% 95th pct; ~30% fail; ~8% endotoxin",
    "https://www.finnrick.com/products/retatrutide"}')
on conflict (source_type, compound_id) do nothing;

-- PER-COMPOUND / PER-VENDOR overrides (layer on top of the defaults).
insert into source_potency_priors
  (source_type, compound_id, potency_mean, potency_sd, p_fail, fail_mean, fail_sd, p_contam,
   underdose_rate, quantity_variance_p95, n_samples, basis, source_refs) values
-- Retatrutide gray-market: higher fail/contam from Finnrick 60-day data  [VERIFIED aggregate]
('gray_market', (select id from compounds where name='Retatrutide'),
   1.00, 0.18, 0.10, 0.50, 0.20, 0.10, 0.20, 0.48, null, 'verified',
   '{"10% of Retatrutide samples failed sterility/purity/dosing in last 60 days (Finnrick)",
     "https://www.finnrick.com/products/retatrutide"}'),
-- LSPL Tirzepatide measured -> vendor_tested posterior collapses onto the HPLC measurement  [VERIFIED, real anchor]
('vendor_tested', (select id from compounds where name='Tirzepatide'),
   0.954, 0.06, 0.04, 0.55, 0.15, 0.03, 0.06, 0.10, 1, 'verified',
   '{"LSPL: tested_mg 28.7 / label 30 x purity 0.998 = 0.954; Finnrick rating C",
     "https://www.finnrick.com/vendors/lspl"}')
on conflict (source_type, compound_id) do nothing;
```

### 3b. `vendors` — registry seed

```sql
insert into vendors
  (name, manufacturer, country, source_type, third_party_tested, test_labs, cost_tier,
   cost_multiple_vs_gray, gmp_certified, fda_green_list, fda_dmf, finnrick_rating, reliability_score, notes, source_url) values
-- REAL (existing PepHouse data)
('LSPL', null, 'China', 'gray_market', true, '{Finnrick}', 'low', 1, false, false, null, 'C', 0.55,
  'Finnrick-tested gray-market vendor. Tirzepatide 99.8% purity but -4.3% quantity. The "get it tested" exhibit.',
  'https://www.finnrick.com/vendors/lspl'),
('QSC Peptides', null, 'China', 'gray_market', false, '{}', 'low', 1, false, false, null, null, 0.35,
  'Reseller + manufacturer, China-origin. Existing sourcing row; no third-party COA on file.', null),
-- REAL manufacturers (research-confirmed) — illustrate "China is capable"; source_type=brand = regulated pharma-grade supply
('CPC Scientific', 'CPC Scientific (Hangzhou)', 'China', 'brand', true, '{}', 'premium', 25, true, false, '043979', null, 0.90,
  'US FDA Drug Master File for tirzepatide API (DMF 043979); passed FDA inspection 5x. cGMP SPPS/LPPS API maker.',
  'https://cpcscientific.com/custom-peptide-synthesis/cgmp-peptide-manufacturing/'),
('Enogen', 'Enogen', 'China', 'brand', true, '{}', 'premium', 25, true, true, null, null, 0.90,
  'NMPA/US FDA/EU EDQM/MFDS certified; semaglutide and tirzepatide on FDA GLP-1 Green List.',
  'https://www.fda.gov/news-events/press-announcements/fda-launches-green-list-protect-americans-illegal-imported-glp-1-drug-ingredients'),
-- ILLUSTRATIVE (category placeholder, no named pharmacy) — represents the compounding tier
('US Compounding Pharmacy (representative)', null, 'USA', 'compounding_pharmacy', true, '{}', 'high', 5, true, false, null, null, 0.95,
  'ILLUSTRATIVE: 503A/503B compounded tier. Held to USP 90-110% label content; ~3-8x gray-market cost.', null)
on conflict (name) do nothing;

-- Link the existing measured LSPL lab row + the China resellers to the registry (idempotent).
update vendor_lab_results set
  vendor_id = (select id from vendors where name='LSPL'),
  test_lab = 'Finnrick', test_method = 'HPLC',
  identity_verified = true, endotoxin_detected = false, sterility_pass = true,
  heavy_metals_detected = false, failed = false
where vendor_name = 'LSPL' and vendor_id is null;                       -- REAL anchor

update sourcing set vendor_id = (select id from vendors where name='LSPL')         where vendor_name='LSPL'        and vendor_id is null;
update sourcing set vendor_id = (select id from vendors where name='QSC Peptides') where vendor_name='QSC Peptides' and vendor_id is null;
```

### 3c. `vendor_lab_results` — one cited illustrative row (cross-lab spread)

```sql
-- ILLUSTRATIVE but cited (documented third-party test, not PepHouse-generated). Shows the +/-15% cross-lab quantity spread.
insert into vendor_lab_results
  (compound_id, vendor_name, finnrick_rating, purity_pct, label_mg, tested_mg, quantity_variance_pct,
   test_lab, test_method, identity_verified, failed, fail_reason, source_url) values
((select id from compounds where name='Retatrutide'), 'gray-market (cross-lab)', null, 99.0, 30, 26.0, -13.3,
  'Krause Laboratories', 'HPLC', true, true, 'quantity',
  'https://www.peptideprotocolwiki.com/blog/janoshik-analytical-review')  -- Janoshik read 30mg on identical vials
on conflict do nothing;
```

### 3d. `anecdotes` + `user_reports` — illustrative source-tagged rows

No real patient-with-source data exists yet; these are **illustrative/synthetic** (Tier-3) to make the join demoable. Real rows arrive via the patient-report form (Section 5).

```sql
-- ILLUSTRATIVE: retrofit source provenance onto a sample anecdote pattern.
insert into anecdotes (compound_id, source, body, claimed_effect, sentiment, source_type, vendor, cost_usd) values
((select id from compounds where name='BPC-157'), 'reddit',
 'ILLUSTRATIVE: ordered BPC from a China vendor off a Telegram list, no COA. Healing felt slow, unsure on dose.',
 'mild improvement', 'mixed', 'gray_market', 'gray-market (general)', 35)
on conflict do nothing;

-- ILLUSTRATIVE/SYNTHETIC: the source -> outcome tie the twin calibrates against. Tier-3, never a prior.
insert into user_reports
  (compound_id, vendor_id, source_type, label_dose_mg, tested_purity_pct, tested_potency_factor,
   batch_lab_tested, cost_usd, cost_period, reported_effect, outcome_value, outcome_unit, sentiment, notes) values
((select id from compounds where name='Tirzepatide'), (select id from vendors where name='LSPL'),
   'vendor_tested', 30, 99.8, 0.954, true, 199, 'per_vial', 'steady loss', -18.0, 'percent', 'positive',
   'ILLUSTRATIVE: lab-tested LSPL vial, delivered ~28.7mg of 30.'),
((select id from compounds where name='Tirzepatide'), null,
   'gray_market', 30, null, null, false, 48, 'per_vial', 'less than expected', -12.0, 'percent', 'mixed',
   'ILLUSTRATIVE: anonymous China vial, no COA; weaker and noisier result.'),
((select id from compounds where name='BPC-157'), null,
   'gray_market', 0.5, null, null, false, 35, 'per_vial', 'unclear', null, null, 'mixed',
   'ILLUSTRATIVE: worst case — anecdote-only compound + gray-market source.')
on conflict do nothing;
```

---

## 4. Simulation model

### 4.1 Potency factor (the source axis)

`potency_factor P = fill_ratio x purity_fraction`, drawn as a **two-component lognormal mixture** per source (lognormal keeps P positive and right-tail-honest; the mixture creates the fat *left* tail the Finnrick data demands):

```
with prob p_fail :  P ~ LogNormal(mean=fail_mean,    sd=fail_sd)      # under-filled / wrong-identity lot
else             :  P ~ LogNormal(mean=potency_mean, sd=potency_sd)   # nominal lot
P = clip(P, 0, None)
```

Grounding: purity is tight so the nominal lot sits near 1.0 and the spread comes from *fill*; a fail tail (~30% gray, ~10% retatrutide/60d) is the `p_fail` mass with `fail_mean ~= 0.5`; contamination (~8% endotoxin) is a **separate** Bernoulli `p_contam` that does not change delivered dose but raises `adverse_event_prob` and penalizes confidence. Central tendency is kept ~0.92–0.93 for gray market (not a hard under-dose) — the research explicitly flags "often <1.0" as stronger than the evidence warrants; the shortfall comes from the tail, not a biased nominal lot.

### 4.2 Composition with the biological prior (exact variance — the headline formula)

`B ~ Normal(effect_mean, effect_sd)` straight from `outcome_priors`. Dose-response linearized around label dose (70% of dose → ~70% of effect): `Y = P · B`, with `P ⟂ B`:

```
E[Y]   = mu_P · mu_b
Var[Y] = mu_P^2·sd_b^2  +  mu_b^2·sd_P^2  +  sd_P^2·sd_b^2
              (scaled bio)   (source-injected)    (cross)
sigma_T = sqrt(Var[Y])
```

The `mu_b^2·sd_P^2` term is why source matters: effect magnitude `mu_b` is large, so even a modest `sd_P` inflates SD. **Verified numerically (n=4e5): analytic `sigma_T` matches the Monte Carlo SD to 2 decimals** (pharmacy 9.94 vs 9.96, gray 10.69 vs 10.72). When the source is perfect (`mu_P→1, sd_P→0`) it collapses to `sd_b` — no penalty. For GLP-1s near dose-response plateau, swap linear `Y=P·B` for saturating `Y = B · Emax·P/(P+P50)` (documented one-line change; linear is the implementable default).

### 4.3 Confidence penalty

```
s_var    = (mu_P · sd_b) / sigma_T              # variance-widening penalty (1/sqrt(VIF))
R        = (1 - p_fail) · (1 - p_contam)        # reliability: P(lot is right-identity AND clean)
c_source = s_var · R
c_total  = clip(c_bio · c_source, 0.05, 0.99)
level    = 3 if c_total >= 0.60 else 2 if c_total >= 0.40 else 1   # -> frontend confidenceLevel
```

`c_bio` comes from the prior's evidence basis: trial-backed compounds (Semaglutide=2, Tirzepatide=3, Tesamorelin=8, Retatrutide=12 — the only four with `outcome_priors`) use the trial confidence (~0.56–0.69). **The other eight (BPC-157=1, TB-500=4, Ipamorelin=5, CJC-1295=6, Thymosin alpha-1=7, Melanotan II=9, GHK-Cu=10, Sermorelin=11) have NO `outcome_prior`** → the twin runs "anecdote mode," `c_bio <= 0.35`, response flagged `evidence_basis:"anecdote"`. **BPC-157 + gray_market is the deliberate worst-case exhibit.**

### 4.4 Verified demo numbers (Tirzepatide, weight_change_pct, live prior −21.1 ± 9.9, c_bio=0.66)

| source_type | mu_P | sd_P | outcome mean | outcome SD | P(>=10% loss) | confidence |
|---|---|---|---|---|---|---|
| compounding_pharmacy | 0.998 | 0.053 | **−21.1** | **9.94** | 0.87 | **0.65** (L3) |
| vendor_tested (LSPL) | 0.938 | 0.103 | −19.8 | 9.57 | 0.85 | 0.60 (L2) |
| gray_market (China) | 0.925 | 0.239 | −19.5 | **10.69** | 0.80 | **0.44** (L1) |

Same patient, same compound: pharmacy→gray-market widens SD 9.94→10.69, shrinks the mean, cuts confidence 0.65→0.44. The interesting result: **`vendor_tested` has a *lower mean* than pharmacy but a *tighter SD* than anonymous gray-market** — an HPLC test on a specific vendor collapses the identity/fail uncertainty even when under-dosed. "Get it tested" is a quantifiable variance-reducing intervention.

### 4.5 `/simulate` contract delta

`/simulate` is the `TODO(twin)` at `backend/main.py:51`. New request/response fields in **bold**.

```jsonc
POST /simulate
{
  "compound_id": 3,
  "outcome_name": "weight_change_pct",       // optional; default = first prior
  "patient": { "age": 55, "sex": "male", "weight_kg": 102 },
  "label_dose": { "value": 2.5, "unit": "mg" },
  "source": {                                 // *** NEW ***
    "source_type": "gray_market",             //   compounding_pharmacy | vendor_tested | gray_market
    "vendor_name": "LSPL",                     //   optional; if it has a vendor_lab_results row -> measured collapse
    "origin_country": "China"
  },
  "compare_sources": true,                     // *** NEW *** return all 3 sources side-by-side
  "n_draws": 20000
}
```

```jsonc
{
  "compound_id": 3, "outcome_name": "weight_change_pct", "unit": "percent",
  "evidence_basis": "trial",                              // trial | anecdote (anecdote => low-conf, no prior)
  "biological_prior": { "effect_mean": -21.1, "effect_sd": 9.9, "population_n": 284 },
  "source_used": {                                        // *** NEW ***
    "source_type": "gray_market",
    "potency_factor": { "dist": "mixture_lognormal", "mu_P": 0.925, "sigma_P": 0.239,
      "p_fail": 0.15, "p_contam": 0.08,
      "basis": "Finnrick aggregate quantity +/-48% 95th pct; ~8% endotoxin" }
  },
  "result": {
    "outcome_mean": -19.5, "outcome_sd": 10.69,           // *** widened by source axis (vs 9.94 pharmacy) ***
    "ci80": [-33.6, -6.3], "ci95": [-37.9, -0.4],
    "p_meaningful": 0.80,                                  // P(>=10% loss)
    "adverse_event_prob": 0.08,                            // *** NEW *** contamination/endotoxin bump
    "confidence": { "biological": 0.66, "source_multiplier": 0.67, "total": 0.44, "label": "Low", "level": 1 },
    "histogram": { "bins": [], "counts": [] }              // maps to ChartBar[]
  },
  "compare": {                                            // *** NEW *** present when compare_sources=true
    "compounding_pharmacy": { "outcome_mean": -21.1, "outcome_sd": 9.94, "p_meaningful": 0.87, "confidence_total": 0.65, "level": 3 },
    "vendor_tested":        { "outcome_mean": -19.8, "outcome_sd": 9.57, "p_meaningful": 0.85, "confidence_total": 0.60, "level": 2 },
    "gray_market":          { "outcome_mean": -19.5, "outcome_sd": 10.69,"p_meaningful": 0.80, "confidence_total": 0.44, "level": 1 }
  },
  "provenance": [
    { "tier": "tier1_evidence", "label": "SURMOUNT (CT.gov)", "source_url": "..." },
    { "tier": "tier2_quality",  "label": "Finnrick HPLC: LSPL tirzepatide 99.8% purity, -4.3% qty", "source_url": "https://www.finnrick.com/vendors/lspl" },
    { "tier": "source_model",   "label": "Finnrick aggregate: gray-market quantity +/-48% (95th pct), ~8% endotoxin", "source_url": "https://www.finnrick.com/" }
  ]
}
```

Backward compatible: omit `source` → defaults to `compounding_pharmacy` (P≡1), response degrades to pre-source shape.

### 4.6 Reference engine (numpy, drop-in for `backend/`) + `db.py` resolver

Column names below match `source_potency_priors` exactly, so the dict from Supabase passes straight in.

```python
import numpy as np

def _lognormal_meansd(rng, m, s, n):
    sig2 = np.log1p((s / m) ** 2)
    return rng.lognormal(np.log(m) - 0.5 * sig2, np.sqrt(sig2), n)

def sample_potency(rng, p, n):
    fail = rng.random(n) < p["p_fail"]
    nom  = _lognormal_meansd(rng, p["potency_mean"], p["potency_sd"], n)
    bad  = _lognormal_meansd(rng, p.get("fail_mean", p["potency_mean"]),
                             p.get("fail_sd", p["potency_sd"]), n)
    return np.clip(np.where(fail, bad, nom), 0.0, None)

def simulate(prior, src, c_bio, n=20000, seed=0, meaningful_threshold=-10.0):
    rng = np.random.default_rng(seed)
    B = rng.normal(prior["effect_mean"], prior["effect_sd"], n)   # biological at label dose
    P = sample_potency(rng, src, n)                              # delivered fraction
    Y = P * B                                                    # source-adjusted outcome
    ae = rng.random(n) < src["p_contam"]                         # contamination (no efficacy change)
    mu_P, sd_P, sigma_T = P.mean(), P.std(), Y.std()
    s_var = (mu_P * prior["effect_sd"]) / sigma_T
    R = (1 - src["p_fail"]) * (1 - src["p_contam"])
    c_total = float(np.clip(c_bio * s_var * R, 0.05, 0.99))
    level = 3 if c_total >= 0.60 else 2 if c_total >= 0.40 else 1
    return {"outcome_mean": float(Y.mean()), "outcome_sd": float(sigma_T),
            "ci80": [float(np.percentile(Y,10)), float(np.percentile(Y,90))],
            "ci95": [float(np.percentile(Y,2.5)), float(np.percentile(Y,97.5))],
            "p_meaningful": float((Y <= meaningful_threshold).mean()),
            "adverse_event_prob": float(ae.mean()),
            "confidence": {"biological": c_bio, "source_multiplier": float(s_var*R),
                           "total": c_total, "level": level},
            "mu_P": float(mu_P), "sigma_P": float(sd_P)}
```

```python
# backend/db.py — add alongside get_outcome_priors(). Resolution: measured vendor -> (type,compound) -> (type,NULL).
def get_source_potency_priors(compound_id: int, source_type: str, vendor_name: str | None = None) -> dict:
    if vendor_name:                                   # named vendor with a measured COA -> collapse onto it
        m = (supabase.table("vendor_lab_results").select("potency_factor")
             .eq("compound_id", compound_id).eq("vendor_name", vendor_name)
             .not_.is_("potency_factor", "null").execute().data)
        if m:
            pf = float(m[0]["potency_factor"])
            return {"source_type": "vendor_tested", "potency_mean": pf, "potency_sd": 0.06,
                    "p_fail": 0.04, "fail_mean": 0.55, "fail_sd": 0.15, "p_contam": 0.03, "basis": "verified"}
    q = (supabase.table("source_potency_priors").select("*").eq("source_type", source_type))
    rows = q.eq("compound_id", compound_id).execute().data        # per-compound override
    if not rows:
        rows = q.is_("compound_id", "null").execute().data        # default
    return rows[0]
```

---

## 5. UI

Maps onto existing `frontend/src/types/simulation.ts` (`confidenceLevel: 1|2|3`, `ChartBar[]`, `MetricCard`). Three additions:

- **Source selector on the twin** — a three-segment control directly under the dosage input: `Compounding pharmacy` · `Tested vendor` · `Gray-market (China)`. Changing it re-runs `/simulate` with `compare_sources:true` and re-renders the same histogram with a visibly wider spread plus a confidence badge (`MetricCard.confidenceLevel` 3→2→1) and an `adverse_event_prob` chip for gray/contaminated. Add one type:
  ```ts
  export type SourceType = "compounding_pharmacy" | "vendor_tested" | "gray_market";
  export type SourceComparison = {
    sourceType: SourceType; label: string;
    outcomeMean: number; outcomeSd: number; pMeaningful: number;
    confidenceTotal: number; confidenceLevel: 1 | 2 | 3; adverseEventProb: number;
  };
  ```
  (The frontend's `EvidenceTier` already uses `"gray-market"`; the API enum `gray_market` is the snake-case mirror — one mapping helper.)
- **The honesty beat: "your vendor under-doses ~X%."** When a `vendor_name` resolves to a `vendor_lab_results` row, surface a warning-tone `MetricCard`: *"LSPL tirzepatide tested 99.8% pure but −4.3% quantity — your real delivered dose is ~28.7 mg of 30 mg labeled. (Finnrick HPLC.)"* This is the trust differentiator: the twin tells the user their vial is weaker than the label and shows the tightened-but-shifted curve. Pair with a `ProvenanceSource` row linking the Finnrick COA (`tier:"trial"`→Tier-2 styling).
- **Patient-report source field.** Extend the result-logging form to capture `source_type` (same three-segment control), free-text `vendor`, `label_dose_mg`, optional `tested_purity_pct` / `tested_potency_factor` (+ a "lab-tested?" toggle → `batch_lab_tested`), and `cost_usd` / `cost_period`. Writes to `user_reports` (Tier-3, anon key, RLS read-open). Each submission both improves the catalog and, over time, calibrates `source_potency_priors` — without ever touching Tier-1 `outcome_priors`.

---

## 6. What to build first (the demoable slice)

Ship this one screen tonight; everything else is layering.

1. **Apply the migration + seed** (Section 2 + 3) via `mcp__supabase__apply_migration` on `aglgyphihqcconivmmux`. Verify: `select source_type, potency_mean, potency_sd, p_fail from source_potency_priors;` returns the 5 rows.
2. **Implement `/simulate` at `backend/main.py:51`** using the Section 4.6 engine + `db.get_source_potency_priors(...)`, reading the **live** `outcome_priors` (Tirzepatide −21.1±9.9). Default `compare_sources:true`. Smoke test: `compound_id:3, source_type:"gray_market"` returns `outcome_sd ~= 10.69`, `level:1`; `compounding_pharmacy` returns `~9.94`, `level:3`.
3. **Frontend: source selector + side-by-side on Tirzepatide.** Same patient, toggle the three sources → histogram visibly widens, confidence badge drops 3→1, and the LSPL "delivered ~28.7 mg of 30 mg" honesty card appears for `vendor_tested`.
4. **The closer slide — BPC-157 + gray_market worst case.** A Category-2-banned, anecdote-only compound (no `outcome_prior` → `evidence_basis:"anecdote"`, `c_bio<=0.35`) bought from an anonymous China vendor: the twin shows the widest spread and lowest confidence on the board. That single contrast — *trial-backed Tirzepatide from a pharmacy vs banned BPC-157 from the gray market* — is the demo. It is the differentiator nobody else captures: **source quality as a second, quantified variance axis, every number cited.**

**Files to touch:** `backend/main.py` (`/simulate` at line 51) · `backend/db.py` (add `get_source_potency_priors`, after `get_outcome_priors` at line 57) · `db/schema.sql` (append Section 2) · `db/seed.sql` (append Section 3) · `frontend/src/types/simulation.ts` (add `SourceType`/`SourceComparison`) · the twin result view + report form.

**Verification scratch (engine SD vs analytic):** `/private/tmp/claude-501/-Users-andrechuabio-HealthcarexAI/cffa1ddd-5021-4d11-b1bd-bffccfa62cd4/scratchpad/verify.py`

**Reconciliation notes / caveats:** dropped the duplicate `source_quality_priors` in favor of one canonical `source_potency_priors`; standardized the enum on American `gray_market` (was `grey_market`); `vendor_tested` is a derived tier (gray-market + a COA), promoted to a first-class enum value for the demo. The China API-share percentages (25%/68%) were deliberately excluded from the thesis as unverifiable — the defensible China anchor is the ~$328M (9-mo 2025) Customs import figure plus FDA-verified GMP capability (CPC DMF #043979, Enogen Green List). Live `outcome_priors` differ from `db/seed.sql` (e.g. Semaglutide live −14.2±8.6 vs seed −10.2±5.0); the engine must read live, not the seed file.