# Handoff — Kien (agent-readable)

Current state of PepHouse so an agent can pick up cleanly. The data foundation AND the live
engine are built and deployed. What's left is mostly wiring the node-builder (Simulation 2) to
the real backend and a few polish items.

## The deployed stack
```
Vercel (frontend)  ──HTTPS──►  Railway (backend, Docker)  ──►  Supabase (Postgres + pgvector)
frontend-alpha-wine-58            pephouse-backend-production         project aglgyphihqcconivmmux
   .vercel.app                       .up.railway.app
```
- **Frontend:** Vercel. Deploy: `cd frontend && vercel --prod --yes`. It calls the backend via `VITE_API_URL` (set on Vercel to the Railway URL) with a hardcoded Railway default in `src/lib/api.ts`. Do NOT repoint this at localhost.
- **Backend:** Railway. Deploy: `railway up -c --service pephouse-backend` from the repo root. The root `Dockerfile` bakes Python + JRE 21 + Synthea so live cohort generation works in the container.
- **Supabase:** project `aglgyphihqcconivmmux`. Frontend reads directly with the publishable key; backend reads with the key in `SUPABASE_SERVICE_ROLE_KEY` (currently the publishable key — read-only is all `/simulate` needs; set the real secret key in Railway if you add writes that need it).

Deploys are **manual**. Backend change → `railway up`. Frontend change → `vercel --prod`. After deploying, **hard-refresh** the app (Cmd+Shift+R) or you'll see a cached bundle.

## The one rule that must not break (the tier wall + honesty invariant)
Tier-3 anecdotes and vendor/editorial claims **never** silently become evidence. The twin's trial
distribution comes only from `outcome_priors`. When a user opts an anecdote tier in, the response
**always** reports `tiers_used`, and including anecdote **visibly drops confidence** (and flags
`illustrative`). Anecdote can inform, but never masquerades as a trial-grade prediction.

## Backend modules (`backend/`)
- `main.py` — FastAPI routes (below).
- `twin_engine.py` — the Monte Carlo. `run_simulation()` draws `N(mean, sd)` from `outcome_priors`, applies the **source axis** (`delivered = label x potency_factor`), the **tier** routing, and the **live/preloaded cohort**. Yours-adjacent; coordinate before refactoring.
- `tiers.py` — tier availability + resolution + the confidence cap (anecdote caps low).
- `modules.py` — Synthea Generic Modules generated from priors (or anecdotes), persisted to `synthea_modules`.
- `synthea_live.py` — live cohort generation. Runs `java` in-container (Railway, `SYNTHEA_CP=/opt/synthea`) or the `synthea-local` Docker image locally. Falls back to the pre-loaded cohort on failure.
- `runs.py` — persists every `/simulate` to `simulation_runs` (inputs + live cohort + result), returns `run_id`.
- `summaries.py` — `/evidence/summary` (structured + optional Claude condense).
- `evidence.py`, `interactions.py`, `user_data.py` — yours (sim data bundle, drug interactions, wearable/bloodwork).
- `db.py` — Supabase client + typed queries. `models.py` — Pydantic request/response.

## Endpoints (live on Railway)
| Method | Path | Purpose |
|---|---|---|
| POST | `/simulate` | the twin Monte Carlo (see contract below) |
| GET | `/compounds/{id}/tiers` | which tiers are available for a compound (for tier toggles) |
| GET | `/compounds/{id}/data` | sim builder data bundle (yours) |
| GET | `/compounds/{id}/evidence` | Tier-1 evidence bundle (grader-citable) |
| POST | `/compounds/{id}/module` | build + persist Synthea module(s) from priors/anecdotes |
| GET | `/compounds/{id}/modules`, `/modules`, `/modules/{id}` | list/read modules |
| GET | `/evidence/summary?nct=…` or `?pmid=…&llm=true` | tight summary of one study/paper |
| GET | `/interactions?ids=1,2` | pairwise drug interactions (yours) |
| GET | `/runs`, `/runs/{id}` | recent runs / one run incl. its cohort |
| GET/POST | `/users/{ref}/data` | user wearable/bloodwork (yours) |

### `/simulate` contract
Request:
```json
{ "compounds": [{ "compound_id": 3 }],
  "patient": { "age": 55, "sex": "M", "weight_kg": 102 },
  "outcomes": ["weight_change_pct"],
  "tiers": ["trial","quality","anecdote","synthetic"],   // optional; omit = legacy trial-only
  "source_type": "gray_market",   // applies when "quality" tier is on
  "live_cohort": true,            // or include "synthetic" in tiers (~15-20s Synthea run)
  "n_draws": 5000, "seed": 42 }
```
Response (key fields): `tiers_used`, `tier_notes`, `cohort_n`, `cohort_source` (`preloaded`|`synthea_live`), `cohort_gen_ms`, `data_confidence`, `run_id`, and `outcomes[]` each with `mean / p10 / p50 / p90 / confidence / evidence_basis / distribution_void / illustrative / source_dud_pct / quarters[]`.

## TOP OPEN ITEM: wire Simulation 2 → the real `/simulate`
Right now Sim 2's "Run Execution" is `setHasRun(true)` and confidence is computed client-side
(`computeSnapshot`). I built the whole bridge as a **self-contained hook** so you don't have to
touch your builder logic: `frontend/src/hooks/useSim2Backend.ts`. It maps your evidence-node
tiers (tier4/tier3 → `trial`, tier2 → `quality`, tier1 → `anecdote`) to the backend and merges the
real Monte-Carlo confidence + ledger into your `SimulationSnapshot`.

Drop-in for `Simulation2Page.tsx` (~4 lines):
```tsx
import { useSim2Backend, mergeBackendSnapshot } from "../hooks/useSim2Backend";
// after `const snapshot = useMemo(...)`:
const backend = useSim2Backend();
const reportSnapshot = mergeBackendSnapshot(snapshot, backend.result);
// in handleRun: setHasRun(true); const bid = compoundBackendIds[0];
//   if (bid) backend.run(bid, { age, sex, weightKg: weight }, sourceFractions);
// pass snapshot={reportSnapshot} to <ReportPanel> and <BreakdownModal>
//   (keep snapshot={snapshot} on <BuilderCanvas> for the live preview)
```

## Evidence-summary dropdown (the "don't make them read a wall of text" idea)
Backend is live. Add to `api.ts`:
```ts
export async function fetchEvidenceSummary(o: { nct?: string; pmid?: string; llm?: boolean }) {
  const q = new URLSearchParams();
  if (o.nct) q.set("nct", o.nct);
  if (o.pmid) q.set("pmid", o.pmid);
  if (o.llm) q.set("llm", "true");
  const res = await fetch(`${import.meta.env.VITE_API_URL}/evidence/summary?${q}`);
  if (!res.ok) throw new Error(`summary failed (${res.status})`);
  return res.json();
}
```
In the evidence node: a "Summary ▾" toggle that calls `fetchEvidenceSummary({ nct })` on first open and renders `.summary` inline; `key_facts` → chips; `source_url` stays as the external link. Structured/instant by default; set **`ANTHROPIC_API_KEY` in Railway** to enable the richer Claude summaries (`llm=true`).

## Gotchas (learned the hard way)
- **Declare your deps.** Adding a 3D globe with `three`/`@react-three/fiber`/`@react-three/drei` but only `npm install`-ing locally broke the build for Vercel + every fresh clone. Always commit `package.json` + `package-lock.json`, not just install.
- **Cohort count ≠ Monte Carlo draws.** `/simulate` `n_draws` (e.g. 5000) are statistical samples of the outcome curve — NOT patients. The Synthea cohort (~20 bodies) is separate; its count varies ~20-24 (Synthea overshoot) and a live run is ~15-20s.
- **After deploys, hard-refresh.** A cached old bundle silently calls the wrong backend.

## Verify it's all live (10s)
```bash
curl -s pephouse-backend-production.up.railway.app/health
curl -s "pephouse-backend-production.up.railway.app/compounds/3/tiers"
curl -s "pephouse-backend-production.up.railway.app/evidence/summary?nct=NCT02637284"
```

See also: `SOURCING.md` (the source-as-variance model), `DATA_CONTRACT.md` (table map), `synthea/README.md` (cohort recipe). Questions → Andre.
