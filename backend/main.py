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
import modules
import runs
import tiers
from evidence import build_simulation_data
from models import SimulateRequest, SimulateResponse, SimulationDataResponse
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


@app.get("/compounds/{compound_id}/data", response_model=SimulationDataResponse)
def get_compound_data(compound_id: int) -> SimulationDataResponse:
    """Supabase data layer for the simulation builder (Arena 2).

    Read-only: returns the compound, its evidence layers/tiers (for the evidence
    map toggles), outcome names, clusters, anecdotes, studied age range, and the
    Tier-4 cohort size. Does NOT run any Monte Carlo — use POST /simulate for that.
    """
    bundle = build_simulation_data(compound_id)
    if bundle is None:
        raise HTTPException(status_code=404, detail="compound not found")
    return bundle


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
        tiers=body.tiers,
    )


@app.get("/compounds/{compound_id}/tiers")
def get_tiers(compound_id: int) -> dict:
    """Which data tiers are available for this compound (for the UI tier toggles)."""
    if db.get_compound(compound_id) is None:
        raise HTTPException(status_code=404, detail="compound not found")
    return tiers.availability(compound_id)


@app.get("/runs")
def list_runs(limit: int = 20) -> list[dict]:
    """Most-recent simulation runs (for the recent-runs list)."""
    return runs.get_recent_runs(limit)


@app.get("/runs/{run_id}")
def get_run(run_id: int) -> dict:
    """One saved run by id, including its live-generated cohort."""
    record = runs.get_run(run_id)
    if record is None:
        raise HTTPException(status_code=404, detail="run not found")
    return record


@app.post("/compounds/{compound_id}/module")
def generate_module(compound_id: int) -> dict:
    """Build + persist a Synthea Generic Module per outcome prior for this compound.

    Returns the saved modules. The most recent active module is auto-loaded by
    live cohort generation (live_cohort=true) so the run is compound-specific.
    """
    if db.get_compound(compound_id) is None:
        raise HTTPException(status_code=404, detail="compound not found")
    saved = modules.generate_and_save(compound_id)
    if not saved:
        raise HTTPException(status_code=400, detail="no outcome_priors to build a module from")
    return {"compound_id": compound_id, "generated": len(saved), "modules": saved}


@app.get("/compounds/{compound_id}/modules")
def list_compound_modules(compound_id: int) -> list[dict]:
    """Recent Synthea modules for one compound."""
    return modules.get_recent_modules(compound_id)


@app.get("/modules")
def list_modules(limit: int = 20) -> list[dict]:
    """Most-recent Synthea modules across all compounds."""
    return modules.get_recent_modules(limit=limit)


@app.get("/modules/{module_id}")
def get_module(module_id: int) -> dict:
    """One module by id, including the full Generic Module JSON."""
    record = modules.get_module(module_id)
    if record is None:
        raise HTTPException(status_code=404, detail="module not found")
    return record


# TODO(grader): POST /grade -> score a clinician transcript against get_evidence()
