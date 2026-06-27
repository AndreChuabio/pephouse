"""Render every row in `synthea_modules` as a Graphviz state graph.

Each Synthea Generic Module is a JSON state machine:
  {
    "name": "...",
    "states": {
      "Initial":  { "type": "Initial",  "direct_transition": "Eligibility" },
      ...
    }
  }

This script pulls every module from Supabase, walks `states` + their
transition fields (direct / distributed / conditional / complex), emits
a Graphviz DOT file per module, and shells out to `dot` to render
PNG + SVG under `synthea/visualizer_out/`. Plus a single `index.html`
that embeds them.

Requires the `dot` binary on PATH:
    brew install graphviz   # macOS
    apt install graphviz    # Debian/Ubuntu

Usage:
    export SUPABASE_URL="https://aglgyphihqcconivmmux.supabase.co"
    export SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."
    python3 synthea/visualize_modules.py

Optional:
    --module-id=N        Render only one module
    --format=svg|png|both    Default: both
    --layout=dot|sfdp|neato  Default: dot (top-to-bottom layered)
    --out-dir=path       Default: synthea/visualizer_out
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

# State-type → (fillcolor, strokecolor, fontcolor) for the DOT nodes.
STATE_PALETTE: dict[str, tuple[str, str, str]] = {
    "Initial":         ("#10b981", "#047857", "white"),
    "Terminal":        ("#ef4444", "#b91c1c", "white"),
    "Guard":           ("#f59e0b", "#b45309", "white"),
    "Encounter":       ("#3b82f6", "#1d4ed8", "white"),
    "Observation":     ("#8b5cf6", "#6d28d9", "white"),
    "Procedure":       ("#0ea5e9", "#0369a1", "white"),
    "MedicationOrder": ("#06b6d4", "#0e7490", "white"),
    "ConditionOnset":  ("#a78bfa", "#7c3aed", "white"),
    "Delay":           ("#71717a", "#3f3f46", "white"),
    "Death":           ("#1f1f23", "#0a0a0a", "#fca5a5"),
}
DEFAULT_PALETTE = ("#52525b", "#3f3f46", "white")


def fetch_modules(supabase_url: str, key: str, module_id: int | None) -> list[dict]:
    qs = "select=id,name,outcome_name,compound_id,active,module,eligibility,source,created_at"
    if module_id is not None:
        qs += f"&id=eq.{module_id}"
    qs += "&order=id.asc"
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/synthea_modules?{qs}",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def fetch_compounds(supabase_url: str, key: str) -> dict[int, str]:
    req = urllib.request.Request(
        f"{supabase_url}/rest/v1/compounds?select=id,name",
        headers={"apikey": key, "Authorization": f"Bearer {key}"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        rows = json.load(resp)
    return {r["id"]: r["name"] for r in rows}


def transitions_of(state: dict) -> list[tuple[str, str]]:
    """Yield (next_state, edge_label) tuples for a single state."""
    if isinstance(state.get("direct_transition"), str):
        return [(state["direct_transition"], "")]

    out: list[tuple[str, str]] = []
    if isinstance(state.get("distributed_transition"), list):
        for entry in state["distributed_transition"]:
            target = entry.get("transition")
            dist = entry.get("distribution")
            label = f"{round(dist * 100)}%" if isinstance(dist, (int, float)) else ""
            if target:
                out.append((target, label))
    if isinstance(state.get("conditional_transition"), list):
        for entry in state["conditional_transition"]:
            target = entry.get("transition")
            cond = entry.get("condition") or {}
            label = cond.get("condition_type") or "if"
            if target:
                out.append((target, label))
    if isinstance(state.get("complex_transition"), list):
        for entry in state["complex_transition"]:
            for sub in entry.get("transitions") or []:
                target = sub.get("transition")
                if target:
                    out.append((target, "complex"))
            target = entry.get("transition")
            if target:
                out.append((target, "complex"))
    return out


def dot_escape(text: str) -> str:
    return text.replace("\\", "\\\\").replace('"', '\\"')


def build_dot(synthea_module: dict) -> str:
    states: dict = synthea_module.get("states", {}) or {}
    if not states:
        return ""

    lines: list[str] = []
    title = synthea_module.get("name", "module")
    lines.append(f'digraph "{dot_escape(title)}" {{')
    lines.append('  rankdir=TB;')
    lines.append('  bgcolor="#0a0a0a";')
    lines.append('  pad=0.35;')
    lines.append('  nodesep=0.45;')
    lines.append('  ranksep=0.65;')
    lines.append('  node [shape=box style="rounded,filled" fontname="Helvetica" fontsize=11 margin="0.15,0.08"];')
    lines.append('  edge [color="#71717a" fontcolor="#a1a1aa" fontname="Helvetica" fontsize=9 arrowsize=0.7];')

    # Nodes
    for name, state in states.items():
        fill, stroke, fontcolor = STATE_PALETTE.get(state.get("type", ""), DEFAULT_PALETTE)
        label = f"{dot_escape(name)}\\n[{dot_escape(state.get('type', '?'))}]"
        lines.append(
            f'  "{dot_escape(name)}" [label="{label}" fillcolor="{fill}" color="{stroke}" fontcolor="{fontcolor}"];'
        )

    # Edges
    for name, state in states.items():
        for target, label in transitions_of(state):
            if target not in states:
                # Render a ghost node so the dangling edge has somewhere to point.
                lines.append(
                    f'  "{dot_escape(target)}" [label="{dot_escape(target)}\\n[MISSING]" '
                    f'fillcolor="#1f1f23" color="#7f1d1d" fontcolor="#fca5a5"];'
                )
            if label:
                lines.append(
                    f'  "{dot_escape(name)}" -> "{dot_escape(target)}" [label="{dot_escape(label)}"];'
                )
            else:
                lines.append(f'  "{dot_escape(name)}" -> "{dot_escape(target)}";')

    lines.append("}")
    return "\n".join(lines)


def render_with_dot(dot_source: str, out_path: Path, fmt: str, layout: str) -> bool:
    """Pipe DOT source through `dot` (or sfdp/neato), write to out_path."""
    try:
        result = subprocess.run(
            [layout, f"-T{fmt}", "-o", str(out_path)],
            input=dot_source,
            text=True,
            capture_output=True,
            timeout=30,
        )
    except FileNotFoundError:
        print(
            f"  ! `{layout}` binary not found — install graphviz (`brew install graphviz`).",
            file=sys.stderr,
        )
        return False
    if result.returncode != 0:
        print(f"  ! {layout} -T{fmt} failed: {result.stderr.strip()}", file=sys.stderr)
        return False
    return True


def write_index(out_dir: Path, modules: list[dict], compound_names: dict[int, str], formats: list[str]) -> None:
    rows = []
    for m in modules:
        mid = m["id"]
        name = m.get("name", "")
        safe = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in name)
        png = f"{mid:03d}-{safe}.png"
        svg = f"{mid:03d}-{safe}.svg"
        states_count = len(m.get("module", {}).get("states", {}) or {})
        cname = compound_names.get(m.get("compound_id"), f"compound {m.get('compound_id')}")
        preview = png if "png" in formats else svg
        rows.append(
            f"""
            <li>
              <header>
                <strong>{name}</strong>
                <span class="meta">id={mid} · compound={cname} · outcome={m.get("outcome_name", "")} · {states_count} states</span>
              </header>
              <a href="{preview}" target="_blank"><img src="{preview}" alt="{name}"/></a>
              <p>
                {'<a href="' + svg + '" target="_blank">SVG ↗</a>' if "svg" in formats else ""}
                {'<a href="' + png + '" target="_blank">PNG ↗</a>' if "png" in formats else ""}
                <a href="{mid:03d}-{safe}.dot" target="_blank">DOT ↗</a>
              </p>
            </li>
            """
        )
    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Synthea modules</title>
<style>
  body {{ font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e4e4e7; margin: 0; padding: 24px; }}
  h1 {{ font-size: 20px; margin: 0 0 16px; color: #fafafa; }}
  ul {{ list-style: none; padding: 0; display: grid; gap: 24px; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); }}
  li {{ background: #18181b; border: 1px solid #27272a; border-radius: 8px; padding: 12px; overflow: hidden; }}
  li header {{ display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }}
  .meta {{ font-size: 12px; color: #a1a1aa; }}
  img {{ width: 100%; height: auto; border-radius: 4px; background: #0a0a0a; display: block; }}
  a {{ color: #60a5fa; text-decoration: none; }}
  a:hover {{ text-decoration: underline; }}
  p {{ margin: 6px 0 0; font-size: 12px; display: flex; gap: 12px; }}
</style></head>
<body>
  <h1>Synthea modules · {len(modules)} total</h1>
  <ul>{"".join(rows)}</ul>
</body></html>
"""
    (out_dir / "index.html").write_text(html)
    print(f"  → index.html  ({len(modules)} modules)", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--module-id", type=int, default=None)
    ap.add_argument("--format", choices=["png", "svg", "both"], default="both")
    ap.add_argument("--layout", choices=["dot", "sfdp", "neato"], default="dot")
    ap.add_argument("--out-dir", default=str(Path(__file__).parent / "visualizer_out"))
    args = ap.parse_args()

    if shutil.which(args.layout) is None:
        sys.exit(
            f"`{args.layout}` binary not found on PATH. Install Graphviz first:\n"
            "  brew install graphviz   # macOS\n"
            "  apt install graphviz    # Debian/Ubuntu"
        )

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY")
    if not url or not key:
        sys.exit(
            "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars before running.\n"
            "See backend/.env.example."
        )

    print(f"Fetching synthea_modules from {urllib.parse.urlparse(url).netloc}…", file=sys.stderr)
    modules = fetch_modules(url, key, args.module_id)
    compound_names = fetch_compounds(url, key)
    if not modules:
        sys.exit("No modules found.")

    fmt_list = ["png", "svg"] if args.format == "both" else [args.format]
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    print(
        f"Rendering {len(modules)} module(s) with {args.layout} to {out_dir}/ …",
        file=sys.stderr,
    )
    for m in modules:
        states = m.get("module", {}).get("states", {}) or {}
        if not states:
            print(f"  · {m.get('name')} (id={m['id']}) — no states, skipping", file=sys.stderr)
            continue
        cname = compound_names.get(m.get("compound_id"), f"compound {m.get('compound_id')}")
        safe = "".join(c if c.isalnum() or c in ("-", "_") else "_" for c in m.get("name", "module"))
        base = out_dir / f"{m['id']:03d}-{safe}"
        dot_src = build_dot(m.get("module", {}) or {})
        base.with_suffix(".dot").write_text(dot_src)
        ok_any = False
        for fmt in fmt_list:
            if render_with_dot(dot_src, base.with_suffix(f".{fmt}"), fmt, args.layout):
                ok_any = True
        if ok_any:
            print(
                f"  → {base.name}.{{{','.join(fmt_list)},dot}}  "
                f"({len(states)} states, compound: {cname})",
                file=sys.stderr,
            )

    write_index(out_dir, modules, compound_names, fmt_list)
    print(f"\nDone. Open {out_dir / 'index.html'}", file=sys.stderr)


if __name__ == "__main__":
    main()
