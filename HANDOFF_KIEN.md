# Handoff — Kien

Everything you need to pick up the backend + Synthea side. Phase 0 (data) is done and verified. Your job is the live engine on top of it.

## Access
- **Repo:** `github.com/kienmd/pephouse` — `git pull`, work on a branch.
- **Supabase:** project `aglgyphihqcconivmmux`, URL `https://aglgyphihqcconivmmux.supabase.co`. Get the **secret key** from Andre (DM) → put in `backend/.env`. Never commit it; it's gitignored.
- **Read `DATA_CONTRACT.md` first** — it's the full table map.

## What already exists (don't rebuild)
- **12 tables, populated and verified.** Compounds (12), trials (84, intervention-verified), `outcome_priors` (7 seed distributions), `case_studies` (19), research_papers (34), anecdotes (37), sourcing, editorial_profiles, `synthetic_patients` (30 from Synthea).
- **Ingestion scripts** in `scripts/` (CT.gov, PubMed, peptidecompared, Reddit, outcome extraction, Synthea load/module-build). All re-runnable.
- **Backend stub** in `backend/` — FastAPI with `/compounds`, `/compounds/{id}/evidence` working. `db.py` already enforces the tier rule (only tier-1 is cited as evidence).

## The one rule that must not break
Tier 3 (anecdotes) + vendor/editorial claims **never** feed `outcome_priors` or a trial citation. The grader cites only Tier 1. The twin's distributions come only from `outcome_priors`. `case_studies.trial_backed` tells you which side a cluster is on. Keep this wall clean.

## Run the backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # fill SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (secret key)
uvicorn main:app --reload
curl localhost:8000/compounds      # should return the 12 compounds
```

## Your tasks

### 1. `POST /simulate` — the live engine (highest priority)
Stub is marked `TODO(twin)` in `backend/main.py`. The logic:
1. Take a patient profile (age, sex, weight_kg, conditions) + a compound + outcome (e.g. `weight_change_pct`).
2. Pull that compound's `outcome_prior` (mean, SD, n, eligibility).
3. **Eligibility check** against the prior's `min_age/max_age/sex` — if the patient doesn't qualify, say so (that's a teaching moment, not an error).
4. Draw the outcome: `numpy.random.normal(mean, sd)` for the twin; or N draws for the cohort distribution.
5. Return the distribution + confidence (from `case_studies.confidence`) + `trial_backed`.
- **Anecdote-only compounds** (BPC-157 etc.) have no prior → return the honest "no real distribution, here are N Reddit anecdotes, wide uncertainty" state instead of a curve.

### 2. Synthea (the cohort generator)
- Recipe is in `synthea/README.md` — three commands, reproduces a cohort. The two gotchas (Zip64, macOS bind mount) are already solved there.
- `scripts/load_synthea.py` loads the CSV into `synthetic_patients`.
- `scripts/build_synthea_module.py` turns `outcome_priors` into a Synthea module JSON (Supabase → Synthea).
- **Architecture note:** Synthea generates the *patients* (bodies); the *drug effect* draw stays in `/simulate` (Monte Carlo off the priors). Do NOT try to make Synthea sample the outcome distribution — it can't do it cleanly. Synthea = who the patients are. Priors = what the drug does.

### 3. The feedback loop (Phase 1+)
- Add a `user_reports` table (user-submitted outcomes from the UI).
- When a report comes in: append it, then **update the prior** (Bayesian update of mean/SD as n grows) — do NOT re-run Synthea per report. The graph evolves because the prior moves; Synthea only re-runs when you want fresh bodies.

## Architecture in one picture
```
Supabase (verified, tiered)
   outcome_priors ──┐                 synthetic_patients (Synthea cohort)
                    │                          │
                    └────►  /simulate  ◄───────┘
                              draw N(mean,SD) per patient, gate on eligibility
                              ▼
                       UI: twin outcome + confidence + honesty band
```

## Verify the foundation yourself (30s)
```sql
select 'compounds' t,count(*) from compounds
union all select 'trials',count(*) from trials
union all select 'outcome_priors',count(*) from outcome_priors
union all select 'case_studies',count(*) from case_studies
union all select 'synthetic_patients',count(*) from synthetic_patients;
-- then open any trials.source_url on CT.gov and confirm matched_intervention is real
```

Questions → Andre. The data won't move under you; build against it freely.
