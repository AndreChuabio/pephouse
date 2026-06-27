"""pephouse backend — registry API + simulation/grader endpoints.

Run locally:
    cd backend
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    cp .env.example .env   # then fill in
    uvicorn main:app --reload
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import db
from models import SimulateRequest, SimulateResponse
from twin_engine import run_simulation

app = FastAPI(title="pephouse")

# Open CORS for the hackathon; tighten before any real deploy.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.get("/compounds")
def list_compounds() -> list[dict]:
    return db.get_compounds()


@app.get("/compounds/{compound_id}")
def get_compound(compound_id: int) -> dict:
    compound = db.get_compound(compound_id)
    if compound is None:
        raise HTTPException(status_code=404, detail="compound not found")
    return compound


@app.get("/compounds/{compound_id}/evidence")
def get_evidence(compound_id: int) -> dict:
    """Tier-1 evidence bundle the grader is allowed to cite."""
    return db.get_evidence(compound_id)


@app.post("/simulate", response_model=SimulateResponse)
def simulate(body: SimulateRequest) -> SimulateResponse:
    """Monte Carlo over outcome_priors; bodies from synthetic_patients in Supabase.

    BTW: this does not invoke Synthea — no JVM, no module run at request time.
    Cohort is pre-loaded in Supabase (see synthea/README.md).

    Nice future: call Synthea at enrollment time (cluster-specific module from
    case_studies + outcome_priors) to evolve comorbidities/labs over the horizon,
    while keeping Tier-1 effect draws in the Monte Carlo — not in the JVM.
    """
    if not body.compounds:
        raise HTTPException(status_code=400, detail="compounds required")
    for c in body.compounds:
        if db.get_compound(c.compound_id) is None:
            raise HTTPException(status_code=404, detail=f"compound {c.compound_id} not found")
    return run_simulation(
        compounds=body.compounds,
        patient=body.patient,
        outcomes=body.outcomes,
        n_draws=body.n_draws,
        seed=body.seed,
        source_type=body.source_type,
        live_cohort=body.live_cohort,
    )


# TODO(grader): POST /grade -> score a clinician transcript against get_evidence()
