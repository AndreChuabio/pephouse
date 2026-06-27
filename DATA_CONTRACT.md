# PepHouse Data Contract (Phase 0 complete)

Supabase project `aglgyphihqcconivmmux`. Read with the publishable key (frontend) or service key (backend). Every table has public-read RLS.

## What the sim consumes

**`case_studies`** — the primary input. One row per evidence cluster per compound.
`compound_id · cluster_label · evidence_basis('trial'|'anecdote') · demographic · reported_effect · typical_dose · n · confidence(0-1) · trial_backed · source_refs[]`
- 7 trial-backed clusters (confidence 0.56-0.69), 12 anecdotal (0.31-0.38).

**`outcome_priors`** — the seed distributions for the Monte Carlo (the numbers Synthea extrapolates from).
`compound_id · outcome_name · effect_mean · effect_sd · unit · population_n · min_age · max_age · sex · source_nct · dispersion_basis`
- 7 priors: Semaglutide/Tirzepatide/Retatrutide (weight % + HbA1c %), Tesamorelin (liver fat %).
- `dispersion_basis` flags whether SD was reported directly or derived `SD = SE x sqrt(n)`.

## Grounding / evidence layer (Tier 1)

- **`compounds`** (12) — the spine. `name · aliases · drug_class · fda_status · approved · summary`.
- **`trials`** (84) — CT.gov, intervention-verified. `nct_id · phase · indication · status · n_enrolled · matched_intervention · source_url`. Fuzzy matches were dropped; `matched_intervention` is the proof.
- **`trial_outcomes`** — raw per-arm outcome measures from CT.gov results (value, dispersion, n, eligibility). Audit staging; reproducible via `scripts/extract_outcome_priors.py`.
- **`research_papers`** (34) — real PubMed metadata, cited on peptidecompared. `is_narrative` flags Reviews/Comments/Meta-analyses (11) vs primary studies (23). Curator-attributed; only title-verified papers were kept.

## Secondary / context layers (never cited as evidence)

- **`editorial_profiles`** (12) — peptidecompared summaries/benefits/dosing/side-effects + `cited_source_links`. Tier-2 editorial.
- **`anecdotes`** (37) — Reddit, real permalinks. `body · claimed_effect · sentiment · dose_mentioned`. Tier-3 — seeds personas/case studies, never outcomes.
- **`vendor_lab_results`** (1) — Finnrick third-party purity tests.
- **`sourcing`** (11) — where compounds are made/shipped from (origin_country, ships_from, vendor). Gray-market = China origin.

## The one rule

Tier 3 (anecdotes) and vendor/editorial claims never feed `outcome_priors` or a trial citation. The grader cites only Tier 1; the twin's distributions come only from `outcome_priors`. `case_studies.trial_backed` tells you which side a cluster is on.

## Compound coverage (for the sim's honesty UI)

- **Trial-grounded (real seed):** Semaglutide, Tirzepatide, Retatrutide, Tesamorelin.
- **Anecdote-only (flag loudly, low confidence):** BPC-157, TB-500, Ipamorelin, CJC-1295, GHK-Cu, Melanotan II, Sermorelin, Thymosin alpha-1.
- BPC-157 is the deliberate "no trial grounding" exhibit.
