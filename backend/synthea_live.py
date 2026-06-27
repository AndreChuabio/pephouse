"""Synthea AT REQUEST TIME: generate a patient-matched cohort live.

Two execution modes, picked automatically:
  * Hosted (container): SYNTHEA_CP points at an exploded Synthea jar -> run `java`
    directly in this container. This is what makes live generation work on Railway.
  * Local dev (your mac): no SYNTHEA_CP -> shell out to the `synthea-local` Docker
    image and stream CSV out as a tar.

Either way we parse the CSV to the SAME shape as the synthetic_patients table so the
twin engine uses live and pre-loaded bodies interchangeably. Returns None on any
failure/timeout so the caller falls back to the pre-loaded cohort -- it degrades,
it never hangs.
"""

from __future__ import annotations

import csv
import io
import os
import subprocess
import tarfile
import tempfile
from datetime import date

SYNTHEA_CP = os.environ.get("SYNTHEA_CP")  # set in the deployed image (exploded jar dir)
DOCKER_IMAGE = "synthea-local"

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


def _map_bodies(patients: list[dict], observations: list[dict], conditions: list[dict]) -> list[dict]:
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


def _synthea_args(lo: int, hi: int, gender: str, n: int, out_dir: str) -> list[str]:
    return [
        "-p", str(int(n)), "-a", f"{lo}-{hi}", "-g", gender,
        "--exporter.csv.export", "true", "--exporter.baseDirectory", out_dir,
        "Massachusetts",
    ]


def _run_java(lo: int, hi: int, gender: str, n: int, timeout_s: int) -> list[dict] | None:
    """Hosted path: run Synthea via java -cp against the exploded jar dir."""
    with tempfile.TemporaryDirectory() as out:
        cmd = ["java", "-cp", SYNTHEA_CP, "App", *_synthea_args(lo, hi, gender, n, out)]
        try:
            subprocess.run(cmd, capture_output=True, timeout=timeout_s, check=False)
        except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
            return None
        csv_dir = os.path.join(out, "csv")
        if not os.path.isdir(csv_dir):
            return None

        def rows(name: str) -> list[dict]:
            path = os.path.join(csv_dir, name)
            if not os.path.exists(path):
                return []
            with open(path, newline="") as fh:
                return list(csv.DictReader(fh))

        return _map_bodies(rows("patients.csv"), rows("observations.csv"), rows("conditions.csv"))


def _run_docker(lo: int, hi: int, gender: str, n: int, timeout_s: int) -> list[dict] | None:
    """Local-dev path: run the synthea-local image and stream CSV out as a tar."""
    args = " ".join(_synthea_args(lo, hi, gender, n, "/out"))
    inner = f"mkdir -p /out && java -cp /app App {args} >/dev/null 2>&1; tar -C /out -cf - csv"
    try:
        proc = subprocess.run(
            ["docker", "run", "--rm", DOCKER_IMAGE, "bash", "-lc", inner],
            capture_output=True, timeout=timeout_s,
        )
    except (subprocess.TimeoutExpired, FileNotFoundError, OSError):
        return None
    if proc.returncode != 0 or not proc.stdout:
        return None
    try:
        with tarfile.open(fileobj=io.BytesIO(proc.stdout)) as tf:
            def rows(name: str) -> list[dict]:
                member = next((m for m in tf.getmembers() if m.name.endswith(name)), None)
                if member is None:
                    return []
                handle = tf.extractfile(member)
                return list(csv.DictReader(io.TextIOWrapper(handle, encoding="utf-8"))) if handle else []

            return _map_bodies(rows("patients.csv"), rows("observations.csv"), rows("conditions.csv"))
    except (tarfile.TarError, KeyError, ValueError):
        return None


def generate_cohort(age: int, sex: str, n: int = 10, span: int = 5, timeout_s: int = 150) -> list[dict] | None:
    """Run Synthea live for a cohort near (age, sex). None on failure/timeout."""
    lo, hi = max(0, age - span), age + span
    gender = "M" if str(sex).upper().startswith("M") else "F"
    runner = _run_java if SYNTHEA_CP else _run_docker
    bodies = runner(lo, hi, gender, n, timeout_s)
    if not bodies:
        return None
    bodies = [b for b in bodies if b["age"] is not None]
    return bodies or None
