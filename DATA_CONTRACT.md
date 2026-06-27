# PepHouse Data Contract (Phase 0 complete)

Supabase project `aglgyphihqcconivmmux`. Read with the publishable key (frontend) or service key (backend). Every table has public-read RLS.

## What `/simulate` does (Andre architecture)

User submits compound + profile → server returns outcome quarters or says it can't.

1. **`synthetic_patients`** — pull matching Tier-4 bodies from Supabase (Synthea cohort already loaded; no Synthea at request time).
2. **`case_studies`** — match cluster (`trial_backed`, confidence).
3. **`outcome_priors`** — Monte Carlo `N(mean, SD)` for trial-backed paths only.
4. **Honesty gates** — no prior → `distribution_void`; ineligible → `excluded_priors`.
5. **Tier-4 miss** — if `cohort_n` too low, pull **`anecdotes`** with `cohort_fallback: "anecdote"` and `substrate_missing: true` (widen SD; never feed anecdotes into priors).

Synthea custom modules are **optional** (see `synthea/README.md`) — not on the `/simulate` hot path.

## What the sim consumes

**`synthetic_patients`** — Tier 4 substrate (age, sex, weight_kg, conditions, baseline_labs). Pre-seeded; `/simulate` filters only.

**`case_studies`** — primary router. One row per evidence cluster per compound.
`compound_id · cluster_label · evidence_basis('trial'|'anecdote') · demographic · reported_effect · typical_dose · n · confidence(0-1) · trial_backed · source_refs[]`

**`outcome_priors`** — Tier-1 seeds for the Monte Carlo engine.
`compound_id · outcome_name · effect_mean · effect_sd · unit · population_n · min_age · max_age · sex · source_nct · dispersion_basis`

**`anecdotes`** — Tier 3. Cohort-miss fallback context only; never outcomes or priors.

## Grounding / evidence layer (Tier 1)

- **`compounds`** (12) — the spine.
- **`trials`** (84) — CT.gov, intervention-verified.
- **`trial_outcomes`** — raw per-arm measures (audit staging).
- **`research_papers`** (34) — PubMed metadata cited on peptidecompared.

## Secondary / context layers (never cited as evidence)

- **`editorial_profiles`** (12) — peptidecompared Tier-2 editorial.
- **`vendor_lab_results`**, **`sourcing`** — quality / gray-market context.

## The one rule

Tier 3 (anecdotes) and vendor/editorial claims never feed `outcome_priors` or a trial citation. The twin's distributions come only from `outcome_priors`. `case_studies.trial_backed` tells you which side a cluster is on.

## Compound coverage (for the sim's honesty UI)

- **Trial-grounded (real seed):** Semaglutide, Tirzepatide, Retatrutide, Tesamorelin.
- **Anecdote-only (flag loudly, low confidence):** BPC-157, TB-500, Ipamorelin, CJC-1295, GHK-Cu, Melanotan II, Sermorelin, Thymosin alpha-1.
- BPC-157 is the deliberate "no trial grounding" exhibit.
