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


# TODO(twin): POST /simulate -> Monte Carlo over outcome_priors for a patient profile
# TODO(grader): POST /grade -> score a clinician transcript against get_evidence()
