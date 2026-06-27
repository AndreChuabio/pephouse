# PepHouse — Simulation Arena Wiring Plan (hardened, 2nd pass)

Wire the (currently mock) Simulation Arena frontend to the live Supabase DB + Monte Carlo engine.

## TEAM: two open decisions before you start
1. **Chart lib — visx vs Recharts.** This plan specs **visx** (fan chart, single-dot rug, per-element opacity/stroke — the strongest honesty viz). It's more code than Recharts. If short on time, Recharts `Area`+`ErrorBar` is the fallback. Pick one and don't mix.
2. **Who owns `POST /simulate`.** This pass assigns the engine to **Andre** (it's a Monte Carlo — his wheelhouse) and the API/data plumbing to **Kien**. `HANDOFF_KIEN.md` earlier put the whole thing on Kien. Decide as a team; the split below assumes Andre owns the engine, Kien owns the data layer.

Current state (verified): components import `MOCK_*` from `data/mockSimulation.ts`, take no props, hold no state. `ArenaHeader` "Run Simulation" has no handler. Chart is hardcoded CSS bars, not a distribution renderer. No charting lib, no `@supabase/supabase-js`, no fetch layer, no `.env`.

---

## 1. Integration — HYBRID
- **Catalog/evidence/provenance → Supabase-direct** (`@supabase/supabase-js` + publishable key). Public-read, no compute, no second deploy target.
- **Monte Carlo → FastAPI `POST /simulate`** (server-authoritative). The honesty rule lives in ONE place server-side: eligibility gate, trial-vs-anecdote branch, n=1 SD-inflation, seeded RNG. A client must not be able to read `outcome_priors` and roll its own confident-looking numbers. CORS is already `*`, so Vite can call it immediately.

## 2. Component wiring map
State owner = `SimulationArenaPage` (holds `selectedCompoundId(s)`, `dose`, `patient`; `useSimulation` feeds the output column).

| View (file) | Replaces | Source | Call |
|---|---|---|---|
| CocktailMixerCard | MOCK_COMPOUNDS | Supabase | `compounds.select('id,name,aliases,drug_class,fda_status,approved,summary')` + `outcome_priors.select('compound_id')` → grounded-set (4 of 12). Badge: `approved ? fda-approved : gray-market`. **Grounded flag drives the loud low-confidence marker.** |
| DemographicsCard | DEMOGRAPHICS | controlled inputs (+ optional seed) | real select/slider (replace FakeSelect/SliderTrack); optional seed `synthetic_patients.select(...).limit(30)`. Feeds `/simulate.patient`. |
| ProjectedOutcomesChart | MOCK_CHART_BARS | `POST /simulate` | `outcomes[].quarters[]` (p10/p50/p90 per quarter) → FanChart (§3). |
| MetricsGrid | MOCK_METRICS | `/simulate` summary | `prob_threshold`, `data_confidence`, real `confidence:number` (drop the 1/2/3 enum; drop the unsourced synergy note). |
| DataProvenanceList | MOCK_PROVENANCE | Supabase (mirror `/simulate.provenance`) | trials: `outcome_priors.select('source_nct,population_n,dispersion_basis,unit')`; anecdotes: `anecdotes.select('source,permalink,claimed_effect,sentiment')`. Add **Tier-1** value to `ProvenanceSource.tier` so trials get a badge. Never merge the two lists. |
| ArenaHeader | — | — | wire "Run Simulation" onClick → `useSimulation.run()`. |

**New files:** `lib/supabase.ts`, `lib/api.ts`, `hooks/{useCompounds,useProvenance,useSyntheticPatients,useSimulation}.ts`, `types/db.ts` (`supabase gen types typescript --project-id aglgyphihqcconivmmux`), `frontend/.env.local`. `npm i @supabase/supabase-js`.

**Type fixes:** `Compound.id` string→number (BIGINT); add `SimulateRequest`/`SimulateResponse`; add Tier-1 to `ProvenanceSource.tier`. `db/schema.sql` is STALE — generate types from the live DB, not the file.

## 3. Honesty-display spec (visx)
`npm i @visx/shape @visx/scale @visx/axis @visx/group @visx/gradient @visx/stats @visx/glyph @visx/tooltip d3-random`

- **`<FanChart>`** — median `LinePath` + ±1 SD ribbon (opaque) + ±2 SD ribbon (faint) over the 12-month horizon. Trial twin stays tight; anecdote twin blows into a cone.
- **Trial vs anecdote encoding (redundant, never color-only):** width = literal SD; fill opacity ∝ confidence; stroke solid (trial) vs **dashed** (anecdote, survives grayscale/colorblind); **rug of actual samples** — n=1 anecdote draws exactly ONE dot (you can't fake confidence when the viewer counts one dot). **Same x-axis AND y-scale for both** — never auto-rescale per panel or the contrast is erased.
- **`<EvidenceVoid>`** for BPC-157 (no prior): do NOT synthesize a curve. Axes + diagonal-hatch "no trial data" + copy "No controlled-trial distribution exists… this is patient-reported anecdote (n=37), not evidence." Show the 37 anecdotes as discrete permalinked cards, never a bell.
- **`<ConfidenceMeter>`** — absolute 0.0–1.0 track (NOT normalized to max). 0.69 sits just past middle. Bands: 0.31–0.45 weak, 0.45–0.60 moderate, 0.60–0.69 trial-supported. No "high" band exists — don't draw one. Tooltip names the driver via `dispersion_basis`.
- **Reminder:** only 4 of 12 compounds have priors, so the anecdote/void branch is the MAJORITY path — build it first-class.

### `POST /simulate` contract (Andre builds, Kien+Nikki code against)
```
REQ: { compounds:[{compound_id,dose_label}], patient:{age,sex,weight_kg,conditions[]},
       outcomes:[...], n_draws:10000, horizon_months:12, seed:42 }
RES: { outcomes:[{ compound_id, outcome_name, unit, evidence_basis, trial_backed, confidence,
                   mean, sd, n, p10, p50, p90, prob_threshold, quarters:[{q,p10,p50,p90}] }],
       excluded_priors:[{compound_id,reason}], data_confidence:"Low"|"High", provenance:[] }
```
Engine per compound×outcome: load priors for `outcome_name` → **eligibility gate** (int-parse text `min_age/max_age`; `sex=='ALL'` wildcard; gated-out → `excluded_priors`, never silently dropped) → **trial branch** (`default_rng(seed).normal(mean,sd,n_draws)`, tight, confidence 0.56–0.69) OR **anecdote branch** (8 priorless compounds: center from `case_studies.reported_effect`, inflated SD, confidence 0.31–0.38) → per-quarter ramp.

## 4. Task list (demo-ordered)
**Vertical slice — one trial-backed compound (Semaglutide or Tirzepatide) end-to-end:**
1. `frontend/.env.local` (URL, publishable key, API base); confirm `.gitignore` covers `frontend/.env*`. *quick*
2. `npm i @supabase/supabase-js`; `lib/supabase.ts`; gen `types/db.ts`. *quick*
3. `POST /simulate` trial branch + eligibility gate, one compound. Verify with curl. *critical*
4. `useSimulation` hook + wire "Run Simulation". *critical*
5. visx `<FanChart>` bound to `quarters[]`. **← real compound, real distribution, end-to-end demo moment.** *critical*

**Honesty contrast (the money shot):**
6. `useCompounds` + grounded-set → real picker. *quick*
7. Anecdote branch + `<EvidenceVoid>` for BPC-157; side-by-side Semaglutide-tight vs BPC-157-void on shared axes. *critical*
8. `<ConfidenceMeter>` on real float + MetricsGrid summary. *quick*
9. `useProvenance` → DataProvenanceList with trial vs anecdote badges. *quick*

**Polish/stretch:** 10. controlled DemographicsCard feeding `patient` (debounce 250ms, stable seed). 11. `excluded_priors` "outside the trial's age window" surfacing. 12. clinician door (ForestPlot over case_studies). 13. `<EvolvingDistribution>` band-tightening as n grows. 14. regenerate stale `db/schema.sql`.

## 5. Three-person split
- **Andre (data/sim) — integrity core, critical path:** the `/simulate` engine + gating helper — eligibility gate (text-parse, ALL wildcard), trial branch (seeded `rng.normal`), anecdote branch (SD inflation, confidence capped ~0.38), `quarters[]`, `excluded_priors`, `data_confidence`. Owns the rule that anecdote SD is wide. Regenerate `db/schema.sql`.
- **Kien (backend/data layer):** `lib/supabase.ts`, `lib/api.ts`, `types/db.ts`, `.env.local`+gitignore; the four hooks; db→view-model mapping (slug↔int id, FDA-status↔grounding split). Keep `/compounds*` alive for the grader path.
- **Nikki (frontend/honesty UI):** visx `<FanChart>` replacing the bar chart; `<EvidenceVoid>`, `<ConfidenceMeter>`, rug/stroke/opacity encoding; extend `types/simulation.ts`; controlled inputs; wire header; MetricsGrid + DataProvenanceList from real data.

**Critical path:** Andre `/simulate` trial branch → Kien `useSimulation`+`types/db` → Nikki `<FanChart>`. **Day-1 unblock:** Kien ships `lib/supabase.ts` + `types/db.ts` first; Andre+Nikki agree the `/simulate` JSON and mock a fixture so Nikki builds `<FanChart>` against it while Andre builds the real engine in parallel. Second sync point = the anecdote branch (step 7) → the BPC-157 void, the demo's strongest honesty statement.

### Risks
1. `outcome_priors.min_age/max_age/sex` are TEXT — gate must int-parse / handle empties or it throws.
2. Only 7 priors / 4 compounds — anecdote+void branch is the majority path, build early.
3. `db/schema.sql` stale — gen types from live DB before writing queries.
4. `Compound.id` string vs BIGINT — fix first or selection breaks.
