"""Vendor registry — the education surface over who people actually buy from.

Design rules, enforced here rather than left to policy:

1. No vendor money touches this module. There is no price, placement, bid, or
   sponsorship anywhere in the read path. A vendor cannot buy a listing, a
   position in the index, or a rating. Nothing they pay for could change what
   this file returns, because there is nothing to pay for.

2. Evidence is graded by who produced it, and the grade is always carried to the
   caller:

       independent  — a third-party assay in vendor_lab_results
       vendor_claim — the vendor's own submission; a claim, not a measurement
       member       — a report from someone who bought it
       none         — nothing on file

   A vendor's own certificate of analysis is not an independent assay and is
   never returned as one. `testing_status` collapses to `independent` only when
   an actual third-party result exists.

3. Absence is a finding, not a blank. A vendor with no testing data on file is
   listed with `testing_status = "none"` and said so plainly. That is the single
   most informative field in the index: most of what people inject has never
   been independently assayed, and the index shows exactly who that is true for.
"""

from __future__ import annotations

import logging
from typing import Any

from db import supabase

logger = logging.getLogger("pephouse.vendors")

# How a vendor's testing evidence is graded, strongest first. The UI renders
# these distinctly; nothing collapses a weaker grade into a stronger one.
TESTING_INDEPENDENT = "independent"
TESTING_VENDOR_CLAIM = "vendor_claim"
TESTING_NONE = "none"


def _rows(table: str, **filters: Any) -> list[dict]:
    """Read a table with equality filters, returning [] if it is absent.

    Several of these tables were created outside schema.sql, so a missing table
    is degraded to empty rather than a 500 — the index still renders, with the
    gap visible.
    """
    try:
        query = supabase.table(table).select("*")
        for column, value in filters.items():
            query = query.eq(column, value)
        return query.execute().data or []
    except Exception:  # noqa: BLE001 - a missing table is an empty section, not a crash
        logger.warning("vendors: could not read %s", table, exc_info=True)
        return []


# The axes a peptide can actually be tested on, and whether a result exists for
# each. This distinction is the whole point of the index.
#
# A grey-market certificate of analysis is almost always HPLC purity plus mass-spec
# identity — which measures the axis that barely varies. Independent testing puts
# purity across the market at roughly 98.7 to 99.95 percent, so a vendor waving a
# 99.8 percent COA is showing you the number that was never going to be bad.
#
# The axes that actually put people in hospital are the ones nobody publishes.
# Independent analysis has found arsenic and lead at up to ten times the
# parenteral limit, endotoxin present in every sample of one 2024 series, and
# vials overfilled by nearly 40 percent. No vendor and no aggregator produces
# endotoxin or heavy-metal data.
#
# So "tested" is not a boolean. Reporting WHICH axes were covered turns a missing
# result from a blank into a finding: this vendor proved the safe thing and never
# checked the dangerous ones.
TEST_AXES = (
    ("purity", "purity_pct"),
    ("identity", "identity_verified"),
    ("potency", "potency_factor"),
    ("endotoxin", "endotoxin_detected"),
    ("heavy_metals", "heavy_metals_detected"),
    ("sterility", "sterility_pass"),
)

# The axes a purity certificate does not cover, and that harm people.
SAFETY_AXES = ("endotoxin", "heavy_metals", "sterility")


def _tested_axes(assays: list[dict]) -> dict[str, bool]:
    """Which test axes have an actual result across this vendor's assays."""
    covered = {axis: False for axis, _ in TEST_AXES}
    for assay in assays:
        for axis, column in TEST_AXES:
            if assay.get(column) is not None:
                covered[axis] = True
    return covered


def _safety_gap(covered: dict[str, bool]) -> list[str]:
    """The safety axes with no result. These are the ones that send people to hospital."""
    return [axis for axis in SAFETY_AXES if not covered.get(axis)]


def _testing_status(assays: list[dict], claims: list[dict]) -> str:
    """Grade a vendor's testing evidence by who produced it.

    An independent assay outranks any claim. A vendor asserting it is
    third-party tested, with no assay on file, is a claim and is labelled one.
    """
    if assays:
        return TESTING_INDEPENDENT
    if any(claim.get("third_party_tested") for claim in claims):
        return TESTING_VENDOR_CLAIM
    return TESTING_NONE


def _published(vendor_id: int, kind: str) -> list[dict]:
    """Reviewed-and-published submissions of one kind for a vendor.

    kind is 'vendor' (a self-disclosure/claim) or 'member' (a buyer report). A
    submission is public only after an operator moves it to 'published'; the
    default kind is 'vendor' so rows predating the split still read as claims.
    """
    return [
        row
        for row in _rows("vendor_submissions", vendor_id=vendor_id)
        if row.get("status") == "published"
        and (row.get("submission_kind") or "vendor") == kind
    ]


def _published_claims(vendor_id: int) -> list[dict]:
    """Vendor self-disclosures that an operator has reviewed and published."""
    return _published(vendor_id, "vendor")


def get_index() -> list[dict]:
    """Every vendor in the registry with its evidence counts and testing grade.

    Vendors with nothing on file are included. Excluding them would hide the
    finding.
    """
    vendors = _rows("vendors")
    index: list[dict] = []
    for vendor in vendors:
        vendor_id = vendor["id"]
        assays = _rows("vendor_lab_results", vendor_id=vendor_id)
        claims = _published_claims(vendor_id)
        reports = _rows("user_reports", vendor_id=vendor_id)
        index.append(
            {
                "id": vendor_id,
                "name": vendor.get("name"),
                "manufacturer": vendor.get("manufacturer"),
                "country": vendor.get("country"),
                "source_type": vendor.get("source_type"),
                "gmp_certified": vendor.get("gmp_certified"),
                "fda_green_list": vendor.get("fda_green_list"),
                "cost_tier": vendor.get("cost_tier"),
                "testing_status": _testing_status(assays, claims),
                "independent_assays": len(assays),
                "vendor_claims": len(claims),
                "member_reports": len(reports),
                "tested_axes": _tested_axes(assays),
                # The safety axes with no result. A vendor can hold a spotless
                # purity certificate and appear here with every one of these
                # missing, which is the finding.
                "safety_gap": _safety_gap(_tested_axes(assays)),
            }
        )
    # Vendors with independent evidence first, then claims, then the unknowns.
    order = {TESTING_INDEPENDENT: 0, TESTING_VENDOR_CLAIM: 1, TESTING_NONE: 2}
    index.sort(key=lambda v: (order[v["testing_status"]], -v["independent_assays"], v["name"] or ""))
    return index


def get_breakdown(vendor_id: int) -> dict | None:
    """The full per-vendor breakdown: identity, assays, claims, member reports.

    Every section carries its provenance, and empty sections stay in the payload
    so the UI can render the gap rather than omit it.
    """
    rows = _rows("vendors", id=vendor_id)
    if not rows:
        return None
    vendor = rows[0]

    assays = _rows("vendor_lab_results", vendor_id=vendor_id)
    claims = _published_claims(vendor_id)
    sourcing = _rows("sourcing", vendor_id=vendor_id)

    # Member reports come from two places: legacy rows seeded directly in
    # user_reports, and buyer reports submitted through the moderation queue and
    # published. Both are the same lowest-grade signal; merge them.
    legacy_reports = _rows("user_reports", vendor_id=vendor_id)
    submitted_reports = _published(vendor_id, "member")

    return {
        "id": vendor_id,
        "name": vendor.get("name"),
        "manufacturer": vendor.get("manufacturer"),
        "country": vendor.get("country"),
        "source_type": vendor.get("source_type"),
        "website": vendor.get("source_url"),
        "telegram": vendor.get("telegram"),
        "whatsapp": vendor.get("whatsapp"),
        "contact_other": vendor.get("contact_other"),
        "gmp_certified": vendor.get("gmp_certified"),
        "fda_green_list": vendor.get("fda_green_list"),
        "fda_dmf": vendor.get("fda_dmf"),
        "cost_tier": vendor.get("cost_tier"),
        "cost_per_vial_usd": vendor.get("cost_per_vial_usd"),
        "cost_multiple_vs_gray": vendor.get("cost_multiple_vs_gray"),
        "notes": vendor.get("notes"),
        "testing_status": _testing_status(assays, claims),
        "tested_axes": _tested_axes(assays),
        "safety_gap": _safety_gap(_tested_axes(assays)),
        # Independent third-party assays. This is the only section that
        # constitutes evidence of testing.
        "independent_assays": [
            {
                "compound_id": a.get("compound_id"),
                "purity_pct": a.get("purity_pct"),
                "label_mg": a.get("label_mg"),
                "tested_mg": a.get("tested_mg"),
                "potency_factor": a.get("potency_factor"),
                "identity_verified": a.get("identity_verified"),
                "endotoxin_detected": a.get("endotoxin_detected"),
                "heavy_metals_detected": a.get("heavy_metals_detected"),
                "sterility_pass": a.get("sterility_pass"),
                "failed": a.get("failed"),
                "fail_reason": a.get("fail_reason"),
                "test_lab": a.get("test_lab"),
                "test_method": a.get("test_method"),
                "test_date": a.get("test_date"),
                "source_url": a.get("source_url"),
            }
            for a in assays
        ],
        # What the vendor says about itself. Claims, not measurements.
        "vendor_claims": [
            {
                "submitted_at": c.get("created_at"),
                "third_party_tested": c.get("third_party_tested"),
                "test_labs": c.get("test_labs") or [],
                "coa_url": c.get("coa_url"),
                "gmp_certified": c.get("gmp_certified"),
                "notes": c.get("notes"),
            }
            for c in claims
        ],
        # What people who bought from them report. Lowest grade, still useful.
        # Legacy user_reports rows and published buyer submissions, merged.
        "member_reports": [
            {
                "compound_id": r.get("compound_id"),
                "tested_purity_pct": r.get("tested_purity_pct"),
                "batch_lab_tested": r.get("batch_lab_tested"),
                "cost_usd": r.get("cost_usd"),
                "sentiment": r.get("sentiment"),
                "notes": r.get("notes"),
                "reported_at": r.get("created_at"),
            }
            for r in legacy_reports
        ]
        + [
            {
                "compound_id": r.get("report_compound_id"),
                "tested_purity_pct": None,
                "batch_lab_tested": r.get("report_batch_lab_tested"),
                "cost_usd": r.get("report_cost_usd"),
                "sentiment": r.get("report_sentiment"),
                "notes": r.get("notes"),
                "reported_at": r.get("created_at"),
            }
            for r in submitted_reports
        ],
        "sourcing": [
            {
                "compound_id": s.get("compound_id"),
                "source_type": s.get("source_type"),
                "origin_country": s.get("origin_country"),
                "ships_from": s.get("ships_from") or [],
                "payment": s.get("payment"),
                "notes": s.get("notes"),
            }
            for s in sourcing
        ],
    }


def sources_for_compound(compound_id: int) -> dict:
    """The sources on file for one compound — the stack report's source match.

    Harm reduction, not a storefront. It surfaces which sources have any data for
    THIS compound, grades each by whether an INDEPENDENT assay exists for it (a
    vendor's own claim is never counted as tested), and names the safety axes that
    were never checked. When no source has been independently tested for the
    compound — the common case in this market — it says so plainly. Nothing here
    is ranked for money and nothing is a recommendation to buy: it informs someone
    who is going to source anyway.
    """
    assays = _rows("vendor_lab_results", compound_id=compound_id)
    reports = _rows("user_reports", compound_id=compound_id)
    sourcing = _rows("sourcing", compound_id=compound_id)

    vendor_ids = {
        row["vendor_id"]
        for row in assays + reports + sourcing
        if row.get("vendor_id") is not None
    }
    if not vendor_ids:
        return {"sources": [], "any_independent_tested": False, "note": "No sources on file for this compound."}

    try:
        vendor_rows = supabase.table("vendors").select("*").in_("id", list(vendor_ids)).execute().data or []
    except Exception:  # noqa: BLE001 - a lookup miss yields an empty match, not a crash
        logger.warning("vendors: could not resolve vendors for compound %s", compound_id, exc_info=True)
        vendor_rows = []
    vendors_by_id = {r["id"]: r for r in vendor_rows}

    sources: list[dict] = []
    for vid in vendor_ids:
        vendor = vendors_by_id.get(vid, {})
        v_assays = [a for a in assays if a.get("vendor_id") == vid]
        v_reports = [r for r in reports if r.get("vendor_id") == vid]
        claims = _published_claims(vid)
        covered = _tested_axes(v_assays)

        # The most informative assay to surface: a failure outranks a pass, since
        # a failed assay is the single most important thing to show.
        assay = None
        if v_assays:
            failed = [a for a in v_assays if a.get("failed")]
            a = (failed or v_assays)[0]
            assay = {
                "purity_pct": a.get("purity_pct"),
                "potency_factor": a.get("potency_factor"),
                "identity_verified": a.get("identity_verified"),
                "endotoxin_detected": a.get("endotoxin_detected"),
                "heavy_metals_detected": a.get("heavy_metals_detected"),
                "sterility_pass": a.get("sterility_pass"),
                "failed": a.get("failed"),
                "fail_reason": a.get("fail_reason"),
                "test_lab": a.get("test_lab"),
                "test_date": a.get("test_date"),
            }

        sources.append(
            {
                "vendor_id": vid,
                "name": vendor.get("name"),
                "source_type": vendor.get("source_type"),
                "country": vendor.get("country"),
                "testing_status": _testing_status(v_assays, claims),
                "assay": assay,
                "tested_axes": covered,
                "safety_gap": _safety_gap(covered),
                "member_reports": len(v_reports),
            }
        )

    # Editorial order only: independent assays first, then claims, then unknowns.
    order = {TESTING_INDEPENDENT: 0, TESTING_VENDOR_CLAIM: 1, TESTING_NONE: 2}
    sources.sort(key=lambda s: (order[s["testing_status"]], 0 if s["assay"] else 1, s["name"] or ""))

    any_independent = any(s["testing_status"] == TESTING_INDEPENDENT for s in sources)
    return {
        "sources": sources,
        "any_independent_tested": any_independent,
        "note": (
            None
            if any_independent
            else (
                "No source has been independently tested for this compound. What is "
                "shown below is a vendor claim or an absence, not a verified result."
            )
        ),
    }


def submit(payload: dict, submitter_ref: str) -> dict:
    """Record a vendor claim or a buyer report against a source.

    Nothing submitted here is published on arrival. It lands as `pending` for
    operator review, because an open write path into a public index is an open
    invitation: a vendor would inflate itself with an invented certificate, a
    competitor would smear a rival with an invented failure, and a vendor would
    flood its own page with five-star reports. Review is what makes the index
    worth reading, and it is why both kinds go through the same gate.

    `submission_kind` is 'vendor' (a self-disclosure) or 'member' (a buyer
    report). A report submitted from a vendor's page carries that vendor's id so
    it attaches on publish without a name-match guess.
    """
    if not payload.get("vendor_name"):
        raise ValueError("vendor_name required")

    kind = payload.get("submission_kind") or "vendor"
    if kind not in ("vendor", "member"):
        raise ValueError("submission_kind must be 'vendor' or 'member'")

    record = {
        "vendor_name": payload["vendor_name"].strip(),
        "vendor_id": payload.get("vendor_id"),
        "submission_kind": kind,
        "manufacturer": payload.get("manufacturer"),
        "country": payload.get("country"),
        "source_type": payload.get("source_type"),
        "website": payload.get("website"),
        # Contact channels — many grey-market sources have no website.
        "telegram": payload.get("telegram"),
        "whatsapp": payload.get("whatsapp"),
        "contact_other": payload.get("contact_other"),
        # Vendor-claim fields (ignored for member reports).
        "third_party_tested": payload.get("third_party_tested"),
        "test_labs": payload.get("test_labs") or None,
        "coa_url": payload.get("coa_url"),
        "gmp_certified": payload.get("gmp_certified"),
        # Member-report fields (ignored for vendor claims).
        "report_compound_id": payload.get("report_compound_id"),
        "report_sentiment": payload.get("report_sentiment"),
        "report_cost_usd": payload.get("report_cost_usd"),
        "report_batch_lab_tested": payload.get("report_batch_lab_tested"),
        "submitted_by": payload.get("submitted_by") or ("member" if kind == "member" else "vendor"),
        "submitter_ref": submitter_ref,
        "notes": payload.get("notes"),
    }
    res = supabase.table("vendor_submissions").insert(record).execute()
    row = (res.data or [{}])[0]
    logger.info("vendors: %s submission recorded for %s", kind, record["vendor_name"])
    return {"id": row.get("id"), "status": row.get("status", "pending")}


def review(submission_id: int, status: str, review_note: str | None, vendor_id: int | None) -> dict:
    """Publish or reject a pending submission.

    Publishing a submission for a vendor we have never seen has to CREATE the
    canonical vendors row, or the approval would vanish: the directory reads from
    `vendors`, and a booth walk-up has no row there yet. The new row carries only
    identity — name, manufacturer, country, source type. It deliberately does NOT
    carry the vendor's testing claim, because `vendors.third_party_tested` reads as
    a fact in the index and a claim is not a fact. The claim stays on the
    submission, where the UI renders it as what it is.
    """
    if status not in ("published", "rejected"):
        raise ValueError("status must be 'published' or 'rejected'")

    rows = _rows("vendor_submissions", id=submission_id)
    if not rows:
        raise ValueError(f"no submission {submission_id}")
    submission = rows[0]

    resolved_vendor_id = vendor_id or submission.get("vendor_id")

    if status == "published" and not resolved_vendor_id:
        existing = (
            supabase.table("vendors")
            .select("id")
            .ilike("name", submission["vendor_name"])
            .execute()
            .data
            or []
        )
        if existing:
            resolved_vendor_id = existing[0]["id"]
        else:
            created = (
                supabase.table("vendors")
                .insert(
                    {
                        "name": submission["vendor_name"],
                        "manufacturer": submission.get("manufacturer"),
                        "country": submission.get("country"),
                        "source_type": submission.get("source_type"),
                        "source_url": submission.get("website"),
                        # Contact channels — a grey-market source often has only
                        # these, not a website.
                        "telegram": submission.get("telegram"),
                        "whatsapp": submission.get("whatsapp"),
                        "contact_other": submission.get("contact_other"),
                        "notes": submission.get("notes"),
                    }
                )
                .execute()
                .data
            )
            resolved_vendor_id = (created or [{}])[0].get("id")
            logger.info(
                "vendors: created vendor %s (%s) from submission %d",
                resolved_vendor_id,
                submission["vendor_name"],
                submission_id,
            )

    supabase.table("vendor_submissions").update(
        {
            "status": status,
            "review_note": review_note,
            "vendor_id": resolved_vendor_id,
        }
    ).eq("id", submission_id).execute()

    logger.info("vendors: submission %d %s", submission_id, status)
    return {"id": submission_id, "status": status, "vendor_id": resolved_vendor_id}


def list_submissions(status: str = "pending", limit: int = 100) -> list[dict]:
    """Operator review queue, newest first."""
    try:
        return (
            supabase.table("vendor_submissions")
            .select("*")
            .eq("status", status)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
            .data
            or []
        )
    except Exception:  # noqa: BLE001
        logger.error("vendors: could not read the submission queue", exc_info=True)
        raise
