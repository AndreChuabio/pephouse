"""Drug-interaction lookup for the simulation builder.

Reads pairwise rows from the live `drug_interactions` Supabase table and
synthesizes `no_data` entries for pairs the table doesn't cover, so the
frontend can render an honest warning instead of staying silent.
"""

from __future__ import annotations

from itertools import combinations

import db
from models import InteractionPair, InteractionsResponse


def _key(a: int, b: int) -> tuple[int, int]:
    return (a, b) if a < b else (b, a)


def build_interactions(compound_ids: list[int]) -> InteractionsResponse:
    """Return pairwise interactions for a set of selected compounds."""
    unique_ids = sorted(set(compound_ids))
    if len(unique_ids) < 2:
        return InteractionsResponse(pairs=[])

    compounds_by_id = db.get_compounds_by_ids(unique_ids)
    rows = db.fetch_drug_interactions(unique_ids)

    # Group documented rows by their unordered pair.
    documented: dict[tuple[int, int], list[dict]] = {}
    for row in rows:
        a = row.get("compound_a_id")
        b = row.get("compound_b_id")
        if a is None or b is None:
            continue
        if a not in compounds_by_id or b not in compounds_by_id:
            # Row references a compound outside the requested set — skip.
            continue
        documented.setdefault(_key(a, b), []).append(row)

    pairs: list[InteractionPair] = []
    for a, b in combinations(unique_ids, 2):
        key = _key(a, b)
        a_name = compounds_by_id.get(a, {}).get("name", f"compound {a}")
        b_name = compounds_by_id.get(b, {}).get("name", f"compound {b}")
        if key in documented:
            for row in documented[key]:
                # Keep the row's stored direction so callers can show "A acts on B".
                ra = row.get("compound_a_id", a)
                rb = row.get("compound_b_id", b)
                pairs.append(
                    InteractionPair(
                        compound_a_id=ra,
                        compound_a_name=compounds_by_id.get(ra, {}).get("name", f"compound {ra}"),
                        compound_b_id=rb,
                        compound_b_name=compounds_by_id.get(rb, {}).get("name", f"compound {rb}"),
                        severity=row.get("severity") or "unknown",
                        mechanism=row.get("mechanism"),
                        management=row.get("management"),
                        source_url=row.get("source_url"),
                        source_kind=row.get("source_kind") or "curated",
                    )
                )
        else:
            pairs.append(
                InteractionPair(
                    compound_a_id=a,
                    compound_a_name=a_name,
                    compound_b_id=b,
                    compound_b_name=b_name,
                    severity="unknown",
                    mechanism="No public DDI data covers this pair (research-compound territory).",
                    management=None,
                    source_url=None,
                    source_kind="no_data",
                )
            )
    return InteractionsResponse(pairs=pairs)
