"""The Synthea -> Supabase "connection": read Synthea's CSV export and load
synthetic patients into the synthetic_patients table.

Synthea has no DB driver. It writes files; this script is the bridge.

Run AFTER generating a cohort:
    ./run_synthea -p 100 --exporter.csv.export true
    python3 scripts/load_synthea.py /path/to/synthea/output/csv

Needs backend/.env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
"""

from __future__ import annotations

import csv
import os
import sys
from datetime import date

from dotenv import load_dotenv
from supabase import create_client

load_dotenv("backend/.env")
sb = create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

# Synthea observation DESCRIPTIONs we care about -> our baseline_labs keys
LAB_MAP = {
    "Body Mass Index": "bmi",
    "Body Weight": "weight_kg",
    "Hemoglobin A1c/Hemoglobin.total in Blood": "hba1c",
    "Glucose": "glucose",
}


def age_from(birthdate: str) -> int | None:
    try:
        b = date.fromisoformat(birthdate)
        t = date.today()
        return t.year - b.year - ((t.month, t.day) < (b.month, b.day))
    except (ValueError, TypeError):
        return None


def read_csv(path: str) -> list[dict]:
    if not os.path.exists(path):
        return []
    with open(path, newline="") as fh:
        return list(csv.DictReader(fh))


def main(csv_dir: str) -> None:
    patients = read_csv(os.path.join(csv_dir, "patients.csv"))
    observations = read_csv(os.path.join(csv_dir, "observations.csv"))
    conditions = read_csv(os.path.join(csv_dir, "conditions.csv"))

    # latest observation value per (patient, lab); conditions list per patient
    labs: dict[str, dict] = {}
    for o in observations:
        key = LAB_MAP.get(o.get("DESCRIPTION", ""))
        if key:
            labs.setdefault(o["PATIENT"], {})[key] = _num(o.get("VALUE"))
    conds: dict[str, list] = {}
    for c in conditions:
        conds.setdefault(c["PATIENT"], []).append(c.get("DESCRIPTION"))

    rows = []
    for p in patients:
        pid = p["Id"]
        baseline = labs.get(pid, {})
        rows.append({
            "age": age_from(p.get("BIRTHDATE")),
            "sex": "male" if p.get("GENDER") == "M" else "female",
            "weight_kg": baseline.get("weight_kg"),
            "conditions": sorted(set(filter(None, conds.get(pid, [])))),
            "baseline_labs": baseline,
        })

    # batch insert (Supabase caps payload size; chunk to be safe)
    for i in range(0, len(rows), 200):
        sb.table("synthetic_patients").insert(rows[i:i + 200]).execute()
    print(f"loaded {len(rows)} synthetic patients into Supabase")


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("usage: python3 scripts/load_synthea.py <synthea/output/csv dir>")
    main(sys.argv[1])
