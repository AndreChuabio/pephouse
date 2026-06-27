"""Synthea AT REQUEST TIME: generate a patient-matched cohort live via Docker.

The twin engine normally reads a pre-loaded cohort from synthetic_patients. With
live_cohort=true, /simulate instead spins the synthea-local image (built per
synthea/README.md) with age/sex filters, streams the CSV export out as a tar on
stdout (no bind mounts -- macOS-safe), parses it in memory, and returns bodies in
the SAME shape as synthetic_patients so the engine can use them interchangeably.

Returns None on timeout / docker error so the caller can fall back to the
pre-loaded cohort -- the endpoint degrades, it does not hang.
"""

from __future__ import annotations

import csv
import io
import subprocess
import tarfile
from datetime import date

IMAGE = "synthea-local"

# Synthea observation DESCRIPTION -> our baseline_labs keys (mirrors scripts/load_synthea.py)
LAB_MAP = {
    "Body Mass Index": "bmi",
    "Body Weight": "weight_kg",
    "Hemoglobin A1c/Hemoglobin.total in Blood": "hba1c",
    "Glucose": "glucose",
}


def _age_from(birthdate: str | None) -> int | None:
    try:
        b = date.fromisoformat(birthdate)
        t = date.today()
        return t.year - b.year - ((t.month, t.day) < (b.month, b.day))
    except (ValueError, TypeError):
        return None


def _num(v: str | None) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _parse(tar_bytes: bytes) -> list[dict]:
    """Extract patients/observations/conditions from the tar and map to body dicts."""
    with tarfile.open(fileobj=io.BytesIO(tar_bytes)) as tf:
        def rows(name: str) -> list[dict]:
            member = next((m for m in tf.getmembers() if m.name.endswith(name)), None)
            if member is None:
                return []
            handle = tf.extractfile(member)
            return list(csv.DictReader(io.TextIOWrapper(handle, encoding="utf-8"))) if handle else []

        patients = rows("patients.csv")
        observations = rows("observations.csv")
        conditions = rows("conditions.csv")

    labs: dict[str, dict] = {}
    for o in observations:
        key = LAB_MAP.get(o.get("DESCRIPTION", ""))
        if key:
            labs.setdefault(o["PATIENT"], {})[key] = _num(o.get("VALUE"))
    conds: dict[str, list] = {}
    for c in conditions:
        conds.setdefault(c["PATIENT"], []).append(c.get("DESCRIPTION"))

    bodies = []
    for p in patients:
        pid = p.get("Id")
        baseline = labs.get(pid, {})
        bodies.append({
            "age": _age_from(p.get("BIRTHDATE")),
            "sex": "male" if p.get("GENDER") == "M" else "female",
            "weight_kg": baseline.get("weight_kg"),
            "conditions": sorted(set(filter(None, conds.get(pid, [])))),
            "baseline_labs": baseline,
        })
    return bodies


def generate_cohort(age: int, sex: str, n: int = 10, span: int = 5, timeout_s: int = 150) -> list[dict] | None:
    """Run Synthea live for a cohort near (age, sex). None on failure/timeout."""
    lo, hi = max(0, age - span), age + span
    gender = "M" if str(sex).upper().startswith("M") else "F"
    inner = (
        f"mkdir -p /out && java -cp /app App -p {int(n)} -a {lo}-{hi} -g {gender} "
        f"--exporter.csv.export true --exporter.baseDirectory /out Massachusetts "
        f">/dev/null 2>&1; tar -C /out -cf - csv"
    )
    try:
        proc = subprocess.run(
            ["docker", "run", "--rm", IMAGE, "bash", "-lc", inner],
            capture_output=True, timeout=timeout_s,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    try:
        bodies = _parse(proc.stdout)
    except (tarfile.TarError, KeyError, ValueError):
        return None
    bodies = [b for b in bodies if b["age"] is not None]
    return bodies or None
