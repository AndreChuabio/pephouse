"""Render 3 example Synthea modules side-by-side: 1, 2, and 3 studies combined.

Demonstrates how pooling multiple studies into one module turns a linear
state chain into a `distributed_transition` fan-out — one branch per
study, weighted by the study's N.

Uses Semaglutide weight-loss data from the STEP program as the worked
example (STEP 1, STEP 4, STEP 5). Each branch lands on its own
Observation with the study-specific effect range, then collapses back
to Terminal.

Output: synthea/visualizer_out/examples/index.html with all three
rendered top-to-bottom as PNG + SVG, plus the DOT source for each.

Requires: `dot` on PATH (brew install graphviz).
"""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

# Reuse the DOT builder from the main visualizer.
sys.path.insert(0, str(Path(__file__).parent))
from visualize_modules import build_dot  # noqa: E402

EXAMPLES_DIR = Path(__file__).parent / "visualizer_out" / "examples"

# Real STEP-program effect sizes from public NEJM/JAMA reports.
# tuple: (short_label, nct_id, N_enrolled, mean_pct, sd_pct, range_low, range_high)
STUDIES = {
    "STEP1": ("STEP1", "NCT03548935", 1961, -14.9, 6.0, -25.0, -5.0),
    "STEP4": ("STEP4", "NCT03548987",  803, -17.4, 6.7, -28.0, -6.0),
    "STEP5": ("STEP5", "NCT03693430",  304, -15.2, 5.5, -25.0, -5.0),
}


def build_module(name: str, branches: list[tuple]) -> dict:
    states: dict = {
        "Initial": {"type": "Initial", "direct_transition": "Eligibility"},
        "Eligibility": {
            "type": "Guard",
            "allow": {
                "condition_type": "And",
                "conditions": [
                    {"condition_type": "Age", "operator": ">=", "quantity": 18, "unit": "years"},
                    {"condition_type": "Age", "operator": "<=", "quantity": 99, "unit": "years"},
                ],
            },
            "direct_transition": "Treatment_Encounter",
        },
        "Terminal": {"type": "Terminal"},
    }

    encounter = {
        "type": "Encounter",
        "encounter_class": "ambulatory",
        "codes": [
            {"system": "SNOMED-CT", "code": "185349003", "display": "Encounter for check up"}
        ],
    }

    if len(branches) == 1:
        label, nct, n, mean, sd, lo, hi = branches[0]
        encounter["direct_transition"] = f"Apply_{label}"
        states["Treatment_Encounter"] = encounter
        states[f"Apply_{label}"] = _observation(label, nct, lo, hi)
    else:
        total_n = sum(b[2] for b in branches)
        encounter["distributed_transition"] = [
            {"distribution": round(n / total_n, 4), "transition": f"Apply_{label}"}
            for (label, _, n, *_rest) in branches
        ]
        states["Treatment_Encounter"] = encounter
        for label, nct, _n, _m, _s, lo, hi in branches:
            states[f"Apply_{label}"] = _observation(label, nct, lo, hi)

    return {
        "name": name,
        "states": states,
        "remarks": [
            f"Pooled across {len(branches)} stud{'y' if len(branches) == 1 else 'ies'}.",
            *(
                f"  - {label}: {nct} (N={n}, mean {mean}% / SD {sd})"
                for label, nct, n, mean, sd, _lo, _hi in branches
            ),
            "Branch weights are study-N / total-N.",
        ],
    }


def _observation(label: str, nct: str, lo: float, hi: float) -> dict:
    return {
        "type": "Observation",
        "category": "vital-signs",
        "unit": "percent",
        "codes": [
            {
                "system": "LOINC",
                "code": "29463-7",
                "display": f"weight_change_pct from {nct}",
            }
        ],
        "range": {"low": lo, "high": hi},
        "direct_transition": "Terminal",
    }


def render(dot_src: str, base: Path, fmts: list[str]) -> None:
    base.with_suffix(".dot").write_text(dot_src)
    for fmt in fmts:
        result = subprocess.run(
            ["dot", f"-T{fmt}", "-o", str(base.with_suffix(f".{fmt}"))],
            input=dot_src, text=True, capture_output=True, timeout=30,
        )
        if result.returncode != 0:
            print(f"  ! dot {fmt} failed: {result.stderr.strip()}", file=sys.stderr)


def main() -> None:
    if shutil.which("dot") is None:
        sys.exit("`dot` not found. Install Graphviz: brew install graphviz")

    EXAMPLES_DIR.mkdir(parents=True, exist_ok=True)

    plans = [
        ("1 study", "Semaglutide weight loss — STEP 1 only", [STUDIES["STEP1"]]),
        ("2 studies", "Semaglutide weight loss — STEP 1 + STEP 4", [STUDIES["STEP1"], STUDIES["STEP4"]]),
        ("3 studies", "Semaglutide weight loss — STEP 1 + STEP 4 + STEP 5",
         [STUDIES["STEP1"], STUDIES["STEP4"], STUDIES["STEP5"]]),
    ]

    rendered: list[tuple[str, str, str, dict]] = []
    for i, (tag, name, branches) in enumerate(plans, start=1):
        module = build_module(name, branches)
        dot_src = build_dot(module)
        base = EXAMPLES_DIR / f"{i:02d}-{tag.replace(' ', '_')}"
        render(dot_src, base, ["png", "svg"])
        rendered.append((tag, name, base.name, module))
        print(f"  → {base.name}.{{png,svg,dot}}  ({len(module['states'])} states)", file=sys.stderr)

    columns = "".join(
        f"""
        <section>
          <header>
            <span class="tag">{tag}</span>
            <h3>{name}</h3>
            <p class="meta">{len(module['states'])} states · {len(module['states']) - 3} Apply_Effect branch(es)</p>
          </header>
          <a href="{base}.png" target="_blank"><img src="{base}.png" alt="{name}"/></a>
          <p class="links"><a href="{base}.svg" target="_blank">SVG ↗</a><a href="{base}.dot" target="_blank">DOT ↗</a></p>
        </section>
        """
        for tag, name, base, module in rendered
    )

    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Synthea — 1 vs 2 vs 3 studies</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e4e4e7; margin: 0; padding: 24px; }}
  h1 {{ font-size: 20px; margin: 0 0 6px; color: #fafafa; }}
  .intro {{ color: #a1a1aa; font-size: 13px; max-width: 720px; margin-bottom: 20px; line-height: 1.55; }}
  .row {{ display: grid; gap: 20px; grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; }}
  section {{ background: #18181b; border: 1px solid #27272a; border-radius: 10px; padding: 14px; }}
  .tag {{ display: inline-block; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #fbbf24; background: rgba(245, 158, 11, 0.1); border: 1px solid rgba(245, 158, 11, 0.3); padding: 2px 8px; border-radius: 4px; }}
  h3 {{ font-size: 14px; margin: 8px 0 4px; color: #fafafa; }}
  .meta {{ font-size: 11px; color: #71717a; margin: 0 0 12px; }}
  img {{ width: 100%; height: auto; border-radius: 4px; background: #0a0a0a; display: block; }}
  .links {{ font-size: 12px; display: flex; gap: 12px; margin: 8px 0 0; }}
  a {{ color: #60a5fa; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
</style></head>
<body>
  <h1>Combining studies in one Synthea module</h1>
  <p class="intro">Same compound + outcome (Semaglutide / weight_change_pct), progressively pooling more source studies. Single study → linear chain; multi-study → <code>distributed_transition</code> fan-out from Treatment_Encounter, one Observation branch per study, weighted by enrolled N.</p>
  <div class="row">{columns}</div>
</body></html>
"""
    (EXAMPLES_DIR / "index.html").write_text(html)
    print(f"\nDone. Open {EXAMPLES_DIR / 'index.html'}", file=sys.stderr)


if __name__ == "__main__":
    main()
