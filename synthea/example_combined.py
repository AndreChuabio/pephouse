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


def _render_study_table(branches: list[tuple]) -> str:
    total_n = sum(b[2] for b in branches)
    rows = []
    for label, nct, n, mean, sd, lo, hi in branches:
        weight = (n / total_n * 100) if len(branches) > 1 else 100
        rows.append(
            f"""
            <tr>
              <td><a href="https://clinicaltrials.gov/study/{nct}" target="_blank">{nct}</a></td>
              <td>{label}</td>
              <td class="num">{n:,}</td>
              <td class="num">{weight:.0f}%</td>
              <td class="num">{mean}% ± {sd}</td>
              <td class="num">[{lo}, {hi}]%</td>
            </tr>
            """
        )
    return f"""
    <h4>Source studies</h4>
    <table class="study-table">
      <thead>
        <tr>
          <th>NCT</th><th>Label</th><th>N</th><th>Weight</th><th>Mean ± SD</th><th>Effect range</th>
        </tr>
      </thead>
      <tbody>{"".join(rows)}</tbody>
    </table>
    """


def _render_state_summary(module: dict) -> str:
    """Studio-style state inspector — one card per state with the same
    property-pane format Studio shows when you click a state node."""
    cards = []
    for name, st in module.get("states", {}).items():
        cards.append(_studio_state_card(name, st))
    return f"""
    <h4>Studio inspector</h4>
    <div class="studio-pane">{"".join(cards)}</div>
    """


def _studio_state_card(name: str, st: dict) -> str:
    st_type = st.get("type", "?")
    rows: list[str] = [
        _kv("Name", f"<code>{name}</code>"),
        _kv("Type", f'<span class="state-type t-{st_type}">{st_type}</span>'),
    ]

    if st_type == "Guard":
        rows.append(_kv("Allow", _render_guard_allow(st.get("allow") or {})))
    elif st_type == "Encounter":
        if st.get("encounter_class"):
            rows.append(_kv("Encounter class", st["encounter_class"]))
        if st.get("codes"):
            rows.append(_kv("Codes", _render_codes_table(st["codes"])))
        if st.get("reason"):
            rows.append(_kv("Reason", st["reason"]))
    elif st_type == "Observation":
        if st.get("category"):
            rows.append(_kv("Category", st["category"]))
        if st.get("codes"):
            rows.append(_kv("Codes", _render_codes_table(st["codes"])))
        if st.get("unit"):
            rows.append(_kv("Unit", st["unit"]))
        r = st.get("range") or {}
        if r:
            rows.append(_kv("Value (range)", f"low <code>{r.get('low')}</code> · high <code>{r.get('high')}</code>"))
        if "exact" in st:
            rows.append(_kv("Value (exact)", f"<code>{st['exact'].get('quantity','')}</code>"))

    rows.append(_kv("Transitions", _render_transitions(st)))

    return f"""
    <article class="studio-card studio-{st_type}">
      <header class="studio-card-head">
        <span class="state-type t-{st_type}">{st_type}</span>
        <code class="studio-name">{name}</code>
      </header>
      <dl class="studio-fields">
        {"".join(rows)}
      </dl>
    </article>
    """


def _kv(label: str, value: str) -> str:
    return f"<dt>{label}</dt><dd>{value}</dd>"


def _render_guard_allow(allow: dict) -> str:
    if not allow:
        return '<em class="muted">always pass</em>'
    op = allow.get("condition_type", "?")
    conds = allow.get("conditions") or []
    if not conds:
        return f'<code>{op}</code>'
    items = "".join(
        f"<li><code>{c.get('condition_type','?')}</code> "
        f"{c.get('operator','')} {c.get('quantity','')} {c.get('unit','')}</li>"
        for c in conds
    )
    return f'<div class="cond-block"><span class="cond-op">{op}</span><ul>{items}</ul></div>'


def _render_codes_table(codes: list[dict]) -> str:
    rows = "".join(
        f"<tr><td><code>{c.get('system','')}</code></td>"
        f"<td><code>{c.get('code','')}</code></td>"
        f"<td>{c.get('display','')}</td></tr>"
        for c in codes
    )
    return f"""
    <table class="codes-table">
      <thead><tr><th>System</th><th>Code</th><th>Display</th></tr></thead>
      <tbody>{rows}</tbody>
    </table>
    """


def _render_transitions(st: dict) -> str:
    if isinstance(st.get("direct_transition"), str):
        return (
            f'<div class="trans"><span class="trans-tag">Direct</span> '
            f'→ <code>{st["direct_transition"]}</code></div>'
        )
    if isinstance(st.get("distributed_transition"), list):
        bars = []
        for t in st["distributed_transition"]:
            pct = round((t.get("distribution") or 0) * 100)
            bars.append(
                f'<div class="trans-row">'
                f'<span class="trans-weight">{pct}%</span>'
                f'<div class="trans-bar"><div class="trans-bar-fill" style="width:{pct}%"></div></div>'
                f'<span>→ <code>{t.get("transition","")}</code></span>'
                f'</div>'
            )
        return (
            '<div class="trans"><span class="trans-tag">Distributed</span>'
            f'<div class="trans-rows">{"".join(bars)}</div></div>'
        )
    if isinstance(st.get("conditional_transition"), list):
        items = "".join(
            f'<li>if <code>{(t.get("condition") or {}).get("condition_type","?")}</code> '
            f'→ <code>{t.get("transition","")}</code></li>'
            for t in st["conditional_transition"]
        )
        return (
            '<div class="trans"><span class="trans-tag">Conditional</span>'
            f'<ul>{items}</ul></div>'
        )
    return '<em class="muted">terminal</em>'


def _render_remarks(module: dict) -> str:
    remarks = module.get("remarks") or []
    if not remarks:
        return ""
    items = "".join(f"<li>{r}</li>" for r in remarks)
    return f"""
    <h4>Remarks</h4>
    <ul class="remarks">{items}</ul>
    """


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

    rendered: list[tuple[str, str, str, dict, list[tuple]]] = []
    for i, (tag, name, branches) in enumerate(plans, start=1):
        module = build_module(name, branches)
        dot_src = build_dot(module)
        base = EXAMPLES_DIR / f"{i:02d}-{tag.replace(' ', '_')}"
        render(dot_src, base, ["png", "svg"])
        rendered.append((tag, name, base.name, module, branches))
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
          <details>
            <summary>Module details</summary>
            <div class="details-body">
              {_render_study_table(branches)}
              {_render_state_summary(module)}
              {_render_remarks(module)}
            </div>
          </details>
        </section>
        """
        for tag, name, base, module, branches in rendered
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
  details {{ margin-top: 12px; border-top: 1px solid #27272a; padding-top: 10px; }}
  summary {{ cursor: pointer; font-size: 12px; color: #d4d4d8; padding: 2px 0; user-select: none; outline: none; }}
  summary::marker, summary::-webkit-details-marker {{ color: #71717a; }}
  summary:hover {{ color: #fafafa; }}
  details[open] summary {{ color: #fafafa; margin-bottom: 8px; }}
  .details-body {{ font-size: 12px; color: #d4d4d8; line-height: 1.5; }}
  .details-body h4 {{ font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #a1a1aa; margin: 10px 0 6px; font-weight: 600; }}
  .details-body table {{ width: 100%; border-collapse: collapse; }}
  .details-body th {{ text-align: left; font-weight: 500; color: #71717a; padding: 4px 6px; border-bottom: 1px solid #27272a; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; }}
  .details-body td {{ padding: 5px 6px; border-bottom: 1px solid #1f1f23; }}
  .details-body td.num {{ font-variant-numeric: tabular-nums; color: #fafafa; }}
  .details-body td.muted {{ color: #71717a; }}
  .details-body code {{ background: #0a0a0a; padding: 1px 5px; border-radius: 3px; font-size: 11px; color: #e4e4e7; }}
  .details-body ul.remarks {{ margin: 0; padding-left: 16px; color: #a1a1aa; font-size: 11px; }}
  .details-body ul.remarks li {{ margin: 2px 0; }}
  .state-type {{ display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 3px; font-weight: 600; }}
  .t-Initial {{ background: rgba(16, 185, 129, 0.2); color: #34d399; }}
  .t-Terminal {{ background: rgba(239, 68, 68, 0.2); color: #f87171; }}
  .t-Guard {{ background: rgba(245, 158, 11, 0.2); color: #fbbf24; }}
  .t-Encounter {{ background: rgba(59, 130, 246, 0.2); color: #60a5fa; }}
  .t-Observation {{ background: rgba(139, 92, 246, 0.2); color: #a78bfa; }}

  /* Studio-style state inspector */
  .studio-pane {{ display: flex; flex-direction: column; gap: 10px; background: #0a0a0a; border: 1px solid #27272a; border-radius: 8px; padding: 10px; max-height: 520px; overflow-y: auto; }}
  .studio-card {{ background: #18181b; border: 1px solid #27272a; border-radius: 6px; overflow: hidden; }}
  .studio-card-head {{ display: flex; align-items: center; gap: 8px; padding: 8px 10px; background: #1f1f23; border-bottom: 1px solid #27272a; }}
  .studio-name {{ font-size: 12px; color: #fafafa; font-weight: 500; }}
  .studio-fields {{ margin: 0; padding: 8px 10px; display: grid; grid-template-columns: max-content 1fr; gap: 6px 14px; align-items: start; }}
  .studio-fields dt {{ font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #71717a; padding-top: 3px; }}
  .studio-fields dd {{ margin: 0; font-size: 12px; color: #d4d4d8; min-width: 0; }}
  .codes-table {{ width: 100%; margin-top: 2px; }}
  .codes-table th {{ font-size: 9px; padding: 2px 4px !important; }}
  .codes-table td {{ font-size: 11px; padding: 3px 4px !important; }}
  .cond-block {{ background: #0a0a0a; border-radius: 4px; padding: 6px 8px; }}
  .cond-op {{ display: inline-block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #fbbf24; background: rgba(245, 158, 11, 0.1); padding: 1px 6px; border-radius: 3px; }}
  .cond-block ul {{ margin: 4px 0 0; padding-left: 16px; font-size: 11px; }}
  .trans {{ display: flex; flex-direction: column; gap: 4px; }}
  .trans-tag {{ display: inline-block; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #60a5fa; background: rgba(59, 130, 246, 0.1); padding: 1px 6px; border-radius: 3px; align-self: flex-start; }}
  .trans-rows {{ display: flex; flex-direction: column; gap: 4px; }}
  .trans-row {{ display: grid; grid-template-columns: 36px 80px 1fr; gap: 8px; align-items: center; font-size: 11px; }}
  .trans-weight {{ text-align: right; font-variant-numeric: tabular-nums; color: #fafafa; font-weight: 500; }}
  .trans-bar {{ background: #27272a; height: 6px; border-radius: 3px; overflow: hidden; }}
  .trans-bar-fill {{ height: 100%; background: linear-gradient(90deg, #60a5fa, #3b82f6); border-radius: 3px; }}
  .trans ul {{ margin: 2px 0 0; padding-left: 16px; font-size: 11px; }}
  .muted {{ color: #71717a; }}
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
