# pephouse — Team Wegovy

Health AI Hackathon (NYC, June 2026).

A voice-first simulator for the hardest conversations in medicine: counseling on hyped, under-evidenced compounds (peptides, then psychedelics). One evidence registry powers two front doors:

- **Clinician door** — interview an AI patient by voice; an evidence-grounded attending grades you, citing the real trial and regulatory record.
- **Patient door (digital twin)** — enter your profile; a Monte Carlo extrapolation off real trial data shows your likely outcome distribution, with loud uncertainty. Education, not prediction.

The shared asset is a **tiered evidence registry** that grounds both, so the AI cites real sources and cannot make things up.

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
- **Tier 4 — Synthetic:** Synthea. Patient baselines, no PHI.

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
Lovable export drops into `frontend/`. Use the Supabase `anon` key only.

## Secrets
`.env` is gitignored. The `service_role` key lives ONLY in `backend/.env`, never in the frontend.

## Ownership
- Twin engine + sim — Andre
- Clinician door (UI + ElevenLabs voice + grader prompt) — teammate 2
- Shared backend/registry + landing + integration — teammate 3 (Kien)
