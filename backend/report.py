"""The stack report — the tier-honest evidence read on what a member is running.

This is the paid product, and it is deliberately dumb: every line of it is
derived from the registry by rule, with no model call anywhere. That is a
product decision, not a shortcut. A report that costs a fraction of a cent to
generate can be re-run for free, priced at a few dollars, and audited line by
line against the tables it came from. A report that hallucinates its way to a
confident sentence about a drug someone is injecting is worth less than nothing.

The verdict per compound is the highest tier of evidence that actually exists for
it, stated plainly, including when the answer is "nothing above forum posts".
Naming the empty shelf IS the product — it is the thing nobody else tells these
people.

Tier ladder (display convention, 4 is strongest):

    4  clinical RCTs and published trials
    3  observational studies and papers
    2  verified real-world lab and source data
    1  anecdote and forum reports
"""

from __future__ import annotations

import logging

import db
import vendors
from evidence import build_simulation_data, completed_trials, unfinished_trials

logger = logging.getLogger("pephouse.report")

# What the highest available tier means, said the way a person would say it.
VERDICTS = {
    4: (
        "trial_backed",
        "Trial-grade evidence exists. There are published clinical trials for this "
        "compound, so claims about it can be checked against real human outcome data.",
    ),
    3: (
        "observational_only",
        "No completed clinical trials on file. What exists is observational and "
        "published-paper evidence, which can suggest an effect but cannot establish one.",
    ),
    2: (
        "source_data_only",
        "No clinical or observational evidence on file. The only data here is about "
        "the SOURCE — purity and potency of what is being sold — not about whether "
        "the compound works.",
    ),
    1: (
        "anecdote_only",
        "No trial evidence, no published papers, no lab data. Everything known about "
        "this compound here comes from anecdote and forum reports. That is not proof "
        "of anything, and anyone telling you otherwise is selling.",
    ),
    0: (
        "no_evidence",
        "Nothing on file at any tier. We have no evidence about this compound to give "
        "you, and we would rather say so than invent something.",
    ),
}


def _top_tier(evidence_sources: list) -> int:
    """The strongest tier that actually has rows behind it."""
    available = [s.display_tier for s in evidence_sources if s.count > 0]
    return max(available) if available else 0


def _trials(rows: list[dict]) -> list[dict]:
    """The trials on file, with the fields that let someone go check for themselves.

    Every row carries its NCT id so a reader can walk out of this report and read
    the registry entry themselves. A claim you cannot check is a claim you should
    not trust, including ours.
    """
    return [
        {
            "nct_id": row.get("nct_id"),
            "phase": row.get("phase"),
            "status": row.get("status"),
            "n_participants": row.get("n_participants") or row.get("enrollment"),
            "source_url": row.get("source_url"),
        }
        for row in rows
    ]


def _compound_section(compound_id: int) -> dict | None:
    """The honest evidence read on one compound."""
    bundle = build_simulation_data(compound_id)
    if bundle is None:
        return None

    tables = bundle.tables
    top = _top_tier(bundle.evidence_sources)
    verdict_key, verdict_text = VERDICTS[top]

    all_trials = tables.get("trials", [])
    finished = completed_trials(all_trials)
    in_progress = unfinished_trials(all_trials)

    return {
        "compound_id": compound_id,
        "name": bundle.name,
        "drug_class": bundle.drug_class,
        "fda_status": bundle.fda_status,
        "approved": bundle.approved,
        "summary": bundle.summary,
        # The ladder, with the count behind every rung. An empty rung stays in the
        # list so the gap is visible rather than omitted.
        "evidence_ladder": [
            {
                "tier": source.display_tier,
                "label": source.label,
                "count": source.count,
                "available": source.available,
            }
            for source in sorted(
                bundle.evidence_sources, key=lambda s: s.display_tier, reverse=True
            )
        ],
        "top_tier": top,
        "verdict": verdict_key,
        "verdict_text": verdict_text,
        # Trials that finished and produced a result. These, and only these, are
        # what put a compound on the top rung.
        "completed_trials": _trials(finished),
        # Registered but unfinished. Genuinely useful — "someone is finally
        # studying this" is worth knowing — but it is a promise, not a finding,
        # and it never raises the tier. Reporting a recruiting trial as evidence
        # is how a compound with nothing behind it comes to look like a drug.
        "trials_in_progress": _trials(in_progress),
        "trials_note": (
            f"{len(in_progress)} registered trial(s) have not produced a result yet. "
            "A registered trial is not evidence."
            if in_progress
            else None
        ),
        "research_papers": len(tables.get("research_papers", [])),
        "case_studies": len(tables.get("case_studies", [])),
        "anecdotes": len(tables.get("anecdotes", [])),
        "lab_results": len(tables.get("vendor_lab_results", [])),
        # Source match: the sources on file for this specific compound, graded by
        # whether an independent assay exists for it and which safety axes went
        # untested. Harm reduction for someone sourcing anyway — not a storefront,
        # not ranked for money, no recommendation to buy.
        "sources": vendors.sources_for_compound(compound_id),
    }


def _interactions(compound_ids: list[int]) -> dict:
    """Pairwise interaction read across the stack, honest about what is missing.

    The interaction table is thin to nonexistent. Rendering "no known interaction"
    over a gap in our data would be a lie with a needle attached to it, so a pair
    we have nothing for is reported as UNKNOWN, explicitly distinguished from safe.
    """
    known = db.fetch_drug_interactions(compound_ids)
    names = db.get_compounds_by_ids(compound_ids)

    by_pair: dict[tuple[int, int], dict] = {}
    for row in known:
        a, b = row.get("compound_a_id"), row.get("compound_b_id")
        if a is None or b is None:
            continue
        by_pair[tuple(sorted((a, b)))] = row

    pairs: list[dict] = []
    for i, a in enumerate(compound_ids):
        for b in compound_ids[i + 1 :]:
            row = by_pair.get(tuple(sorted((a, b))))
            pairs.append(
                {
                    "compound_a_id": a,
                    "compound_a_name": (names.get(a) or {}).get("name"),
                    "compound_b_id": b,
                    "compound_b_name": (names.get(b) or {}).get("name"),
                    "severity": (row or {}).get("severity", "unknown"),
                    "mechanism": (row or {}).get("mechanism"),
                    "management": (row or {}).get("management"),
                    "has_data": row is not None,
                }
            )

    unknown = sum(1 for p in pairs if not p["has_data"])
    return {
        "pairs": pairs,
        "pairs_with_data": len(pairs) - unknown,
        "pairs_without_data": unknown,
        # Stated in the payload so the UI cannot quietly render silence as safety.
        "note": (
            "An unknown pair means we have no interaction data on file for it. "
            "It does not mean the combination is safe."
            if unknown
            else None
        ),
    }


def build(compound_ids: list[int]) -> dict:
    """The full stack report: a section per compound, plus the interaction read."""
    if not compound_ids:
        raise ValueError("at least one compound is required")

    sections: list[dict] = []
    missing: list[int] = []
    for compound_id in compound_ids:
        section = _compound_section(compound_id)
        if section is None:
            missing.append(compound_id)
            continue
        sections.append(section)

    if not sections:
        raise ValueError("no known compounds in this stack")

    # Bucket by the highest tier that actually has rows behind it. Every compound
    # lands in exactly one bucket: an earlier version split the stack into
    # "trial-backed" and "anecdote-only" and silently dropped everything in
    # between, so a stack of three trial-backed compounds and five weak ones
    # reported as "all eight have trial-grade evidence". The buckets must cover
    # the whole stack or the headline lies.
    trial_backed = [s["name"] for s in sections if s["top_tier"] == 4]
    not_trial_backed = [s["name"] for s in sections if s["top_tier"] < 4]

    return {
        "compounds": sections,
        "interactions": _interactions([s["compound_id"] for s in sections]),
        "unknown_compound_ids": missing,
        "summary": {
            "total": len(sections),
            "trial_backed": trial_backed,
            "observational_only": [s["name"] for s in sections if s["top_tier"] == 3],
            "source_data_only": [s["name"] for s in sections if s["top_tier"] == 2],
            "anecdote_only": [s["name"] for s in sections if s["top_tier"] == 1],
            "no_evidence": [s["name"] for s in sections if s["top_tier"] == 0],
            "headline": _headline(len(sections), trial_backed, not_trial_backed),
        },
    }


def _headline(total: int, trial_backed: list[str], not_trial_backed: list[str]) -> str:
    """One sentence on the whole stack, leading with the weakest link.

    The two lists must partition the stack. Leading with the weak half is
    deliberate: someone running one approved drug alongside four unstudied ones
    should not read a headline that opens with the reassuring part.
    """
    if not not_trial_backed:
        return f"All {total} compounds in this stack have completed-trial evidence on file."
    if not trial_backed:
        return (
            f"None of the {total} compounds in this stack have completed-trial evidence "
            f"behind them. {_join(not_trial_backed)} rest on weaker evidence or none at all."
        )
    return (
        f"{len(trial_backed)} of {total} in this stack have completed-trial evidence. "
        f"{_join(not_trial_backed)} do not, and should not be treated as equivalent."
    )


def _join(names: list[str]) -> str:
    """Join names the way a person would say them out loud."""
    if len(names) == 1:
        return names[0]
    if len(names) == 2:
        return f"{names[0]} and {names[1]}"
    return f"{', '.join(names[:-1])}, and {names[-1]}"
