# pephouse — Team Wegovy

Health AI Hackathon (NYC, June 2026).

A voice-first simulator for the hardest conversations in medicine: counseling on hyped, under-evidenced compounds (peptides, then psychedelics). One evidence registry powers two front doors:

- **Clinician door** — interview an AI patient by voice; an evidence-grounded attending grades you, citing the real trial and regulatory record.
- **Patient door (Simulation Arena)** — enter your profile; `POST /simulate` returns quarter-by-quarter outcome bands from Tier-1 priors, with void/excluded paths for honest compounds. Education, not prediction.

The shared asset is a **tiered evidence registry** that grounds both, so the AI cites real sources and cannot make things up.

## v1: `POST /simulate` (implemented)

Monte Carlo twin engine — **does not invoke Synthea at request time**. Bodies come from pre-loaded `synthetic_patients` in Supabase; effects come from `outcome_priors`.

```bash
# after backend setup (see below)
curl -X POST http://localhost:8000/simulate \
  -H 'Content-Type: application/json' \
  -d '{"compounds":[{"compound_id":3}],"patient":{"age":55,"sex":"M","weight_kg":102},"outcomes":["weight_change_pct"],"seed":42}'
```

| Path | Behavior |
|------|----------|
| Trial-backed (e.g. Tirzepatide) | `quarters[]` fan from `N(mean, SD)` + eligibility gate |
| Anecdote-only (e.g. BPC-157) | `distribution_void: true` + Tier-3 anecdotes |
| Ineligible patient | `excluded_priors` with reason |
| Thin Tier-4 match | `substrate_missing`, anecdote fallback, widened SD |

See `DATA_CONTRACT.md`, `backend/twin_engine.py`, and `synthea/README.md` (offline cohort only).

## Structure

```
pephouse/
├── backend/        FastAPI: registry API, twin engine, grader, model routing
├── frontend/       React + Vite: landing + the two doors
├── db/             schema.sql (source of truth) + seed.sql
└── data/           static Tier 2/3/4 snapshots (finnrick, reddit, synthea)
```

## Data tiers (the one rule)

Every source is tagged by trust, and **Tier 3 / vendor claims never count as evidence or outcomes**:

- **Tier 1 — Evidence:** ClinicalTrials.gov, openFDA, FDA bulks list, PubMed. Grounds the grader's citations and the twin's priors.
- **Tier 2 — Quality:** Finnrick lab tests, vendor scrapes. Real-world purity/quality reality.
- **Tier 3 — Anecdote:** Reddit. Seeds patient personas ONLY.
- **Tier 4 — Synthetic:** Synthea-generated bodies in `synthetic_patients` (offline load; `/simulate` reads Supabase only).

## Setup

### Database (Supabase)
1. In the SQL Editor, run `db/schema.sql` then `db/seed.sql`.
2. Enable the `vector` extension (the schema does this, or Database -> Extensions).
3. Grab `Project URL`, `anon key` (frontend), `service_role key` (backend only) from Settings -> API.

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # fill in Supabase + model keys
uvicorn main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev    # http://localhost:5173/simulation-arena
```
Simulation Arena UI exists; wiring to `/simulate` is next. Data Explorer at `/explorer`.

## Registry status

Phase 0 data is loaded in Supabase (compounds, trials, priors, case studies, anecdotes, ~47 synthetic patients). Ingestion scripts live under `scripts/`.

## Secrets
`.env` is gitignored. The `service_role` / secret key lives ONLY in `backend/.env`, never in the frontend.

## Ownership
- Twin engine + sim — Andre
- Clinician door (UI + ElevenLabs voice + grader prompt) — teammate 2
- Shared backend/registry + landing + integration — teammate 3 (Kien)
