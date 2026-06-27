# PepHouse — Simulation Arena Wiring Plan

Wire the (currently mock) Simulation Arena frontend to the live Supabase DB + Monte Carlo engine.

**Current state (verified):** components import `MOCK_*` from `data/mockSimulation.ts`, take no props, hold no state; `SimulationArenaPage.tsx` renders them statically. Chart is a hardcoded CSS-bar with a fixed 0-100% axis — not a distribution renderer. No charting lib, no `@supabase/supabase-js`, no fetch layer, no `.env`.

---

## 1. Integration approach — HYBRID
- **Direct Supabase** (`@supabase/supabase-js` + publishable key) for static catalog reads: compounds, case_studies, outcome_priors metadata, trials, anecdotes, synthetic_patients. Public-read RLS is already on.
- **FastAPI `POST /simulate`** for the Monte Carlo only — the numpy draw + eligibility gate + tier wall stay server-side.
- Anti-pattern: don't proxy catalog data through FastAPI AND hit Supabase for it. One source per concern: catalog = Supabase, compute = backend.

## 2. Component wiring map
State owner = `SimulationArenaPage` (holds `selectedCompoundId`, `dose`, `patient`; passes props down; runs `useSimulation`).

| Component | Mock now | New source | Call |
|---|---|---|---|
| CocktailMixerCard | MOCK_COMPOUNDS | Supabase | `compounds.select('id,name,drug_class,fda_status,approved,summary')`; tier badge = `approved ? fda-approved : gray-market` |
| DemographicsCard | DEMOGRAPHICS | local state (INPUT) | optional seed from `synthetic_patients` (the 30 Synthea rows) |
| ProjectedOutcomesChart | MOCK_CHART_BARS | backend `/simulate` | `distribution.histogram` + `.timeline` |
| MetricsGrid | MOCK_METRICS | backend `/simulate` | `p10/p50/p90`, `confidence`, `trial_backed`, `eligible` |
| DataProvenanceList | MOCK_PROVENANCE | Supabase | `trials` (tier1) styled as evidence; `anecdotes` styled with permalink badge — never merged |

**Type fixes (`types/simulation.ts`):** `Compound.id` string -> number (BIGINT); add `SimulateRequest`/`SimulateResponse` (no `any`); generate `types/db.ts` from the LIVE DB — `db/schema.sql` is stale (missing case_studies, editorial_profiles, research_papers, sourcing, extra outcome_priors cols).

**New files (`frontend/src/`):** `lib/supabase.ts`, `lib/api.ts`, `hooks/useCompounds.ts`, `hooks/useEvidence.ts`, `hooks/useSimulation.ts`, `.env.local`. `npm i @supabase/supabase-js recharts`.

```
VITE_SUPABASE_URL=https://aglgyphihqcconivmmux.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable key from Settings -> API>
VITE_API_BASE_URL=http://localhost:8000
```

## 3. Honesty-display spec (chart lib: Recharts)
Two mutually exclusive render modes, keyed on `trial_backed`:

| | TRIAL-BACKED (distribution present) | ANECDOTE-ONLY (distribution null) |
|---|---|---|
| Render | histogram + tight p10-p90 band | wide band (2-3x wider), dashed/hatched, muted |
| Color | solid blue/emerald | amber/zinc, low opacity — reads as "not science" |
| Label | `n = population_n` (e.g. 100) | `n = anecdote n`, "Reddit anecdotes — low confidence" |
| Confidence | 0.56-0.69 -> meter 2-3 | 0.31-0.38 -> meter 1 + "No trial-grounded distribution" |
| Footnote | `dispersion_basis` | fallback message + permalinks |

`eligible=false` -> overlay "out-of-population (teaching moment)", still show curve as extrapolated.
**Tier wall:** anecdotes only ever render the wide-band fallback / community panel — never the histogram. Only 4 of 12 compounds have priors, so **the anecdote-only branch is the majority path — build it first-class, not as an edge case.**

## 4. Prioritized task list (demo-ordered)
**Vertical slice first (one real compound, one real distribution):**
1. [Kien] `POST /simulate` happy path — Tirzepatide / weight_change_pct: `normal(mean, sd, n)` -> p10/p50/p90 + histogram + timeline. *quick win*
2. [Nikki] Supabase catalog read -> real compounds in picker. *quick win*
3. [Nikki] Recharts distribution chart replacing MOCK_CHART_BARS; lift state into page; wire `useSimulation`.
4. [Nikki] MetricsGrid from simulate response.
→ Tirzepatide shows a real trial-backed n=100 distribution = **the demo spine.**

**Honesty payoff:**
5. [Kien] `/simulate` anecdote-only branch (`trial_backed=false`, `anecdote_fallback` from anecdotes + case_studies). *highest demo value*
6. [Nikki] Wide-band fallback render — switch Tirzepatide -> BPC-157, watch tight curve become wide low-confidence band.
7. [Nikki] DataProvenanceList — real trials + anecdote permalinks.

**Polish:** 8. [Kien] eligibility gate (parse TEXT min/max_age defensively). 9. [Andre] `compound_summary` view (counts per compound, one read powers all picker cards). 10. [Andre] DemographicsCard "Import EHR" from a synthetic_patients row.

**Stretch:** `/report` + Bayesian prior update + Supabase Realtime on outcome_priors = the evolving graph; vendor_lab_results panel; editorial copy panel.

## 5. Three-person split
- **Andre (data/sim):** regenerate TS types from live DB (unblocks everyone day 1); `compound_summary` view; validate the 7 priors plot sanely; spec the anecdote-fallback math (mean of reported effects, SD inflated by low confidence); Synthea seed for DemographicsCard.
- **Kien (backend):** `POST /simulate` happy path -> anecdote branch -> eligibility gate. Enforce the tier wall. Replace CORS `*` before deploy. Stretch: `/report` + Bayesian update.
- **Nikki (frontend):** install deps; convert 5 prop-less components to props; lift state; tasks 2,3,4,6,7. The dual render-mode chart is the headline.

**Critical path:** Task 1 -> 3 -> 5/6. The demo dies without 1, 3, 5, 6.

### `POST /simulate` contract (Kien's interface, Nikki codes against it)
```
REQ:  { compound_id:int, outcome_name?:str, patient:{age,sex,weight_kg,conditions[]},
        dose?:str, n_draws:int=10000, horizon_months:int=12 }
RES:  { compound_id, compound_name, outcome_name, unit, trial_backed:bool, eligible:bool,
        eligibility_note, confidence:float,
        distribution: null | { mean, sd, n, p10, p50, p90,
                               histogram:[{bin,count}], timeline:[{month,mean,sd}] },
        anecdote_fallback: null | { n, wide_uncertainty:true, claimed_effects[], permalinks[], message },
        sources:{ nct[], source_url, dispersion_basis } }
```
`distribution` and `anecdote_fallback` are mutually exclusive — exactly one is non-null. That switch is what the whole honesty display keys on.

### Risks (flag now)
1. `outcome_priors.min_age/max_age/sex` are TEXT — gate must parse empties/non-numerics or it throws.
2. Only 7 priors / 4 compounds — anecdote branch is the majority path, build early.
3. `db/schema.sql` stale — regenerate types from live DB before writing queries.
4. `Compound.id` string vs BIGINT mismatch — fix first or selection breaks.
