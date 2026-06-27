"""Evidence summaries for the Simulation 2 side panel.

Clicking a ClinicalTrials.gov study or a PubMed paper opens a wall of text; this
returns a tight summary instead. Two modes:
  * structured (default, instant): assembled from the fields we already store,
    no external call, no LLM. Always works.
  * llm=true: fetch the CT.gov brief summary / PubMed abstract and have Claude
    condense it. Best-effort -- falls back to structured if no key or the call
    fails. Set ANTHROPIC_API_KEY on the backend to enable it.
"""

from __future__ import annotations

import os

import httpx

from db import supabase

ANTHROPIC_MODEL = os.environ.get("SUMMARY_MODEL", "claude-haiku-4-5-20251001")


def _claude(prompt: str, max_tokens: int = 320) -> str | None:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        resp = httpx.post(
            "https://api.anthropic.com/v1/messages",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json"},
            json={"model": ANTHROPIC_MODEL, "max_tokens": max_tokens, "messages": [{"role": "user", "content": prompt}]},
            timeout=30,
        )
        if resp.status_code != 200:
            return None
        blocks = resp.json().get("content", [])
        text = "".join(b.get("text", "") for b in blocks if b.get("type") == "text").strip()
        return text or None
    except (httpx.HTTPError, ValueError, KeyError):
        return None


def _ctgov(nct_id: str) -> dict | None:
    try:
        resp = httpx.get(f"https://clinicaltrials.gov/api/v2/studies/{nct_id}", timeout=15)
        if resp.status_code != 200:
            return None
        proto = resp.json().get("protocolSection", {})
        ident = proto.get("identificationModule", {})
        return {
            "title": ident.get("officialTitle") or ident.get("briefTitle"),
            "brief": proto.get("descriptionModule", {}).get("briefSummary"),
            "outcomes": [
                o.get("measure")
                for o in proto.get("outcomesModule", {}).get("primaryOutcomes", [])
                if o.get("measure")
            ],
        }
    except (httpx.HTTPError, ValueError):
        return None


def _pubmed_abstract(pmid: str) -> str | None:
    try:
        resp = httpx.get(
            "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi",
            params={"db": "pubmed", "id": str(pmid), "rettype": "abstract", "retmode": "text"},
            timeout=15,
        )
        if resp.status_code != 200:
            return None
        return (resp.text or "").strip()[:4000] or None
    except httpx.HTTPError:
        return None


def summarize_trial(nct_id: str, use_llm: bool = False) -> dict:
    rows = supabase.table("trials").select("*").eq("nct_id", nct_id).limit(1).execute().data
    row = rows[0] if rows else {}

    parts: list[str] = []
    intervention = row.get("matched_intervention")
    indication = row.get("indication")
    parts.append(
        f"{row.get('phase') or 'Unphased'} study of {intervention or 'the compound'}"
        f" for {indication or 'an unspecified indication'}."
    )
    if row.get("n_enrolled"):
        parts.append(f"Enrollment: {row['n_enrolled']}.")
    if row.get("status"):
        parts.append(f"Status: {row['status']}.")
    if row.get("primary_endpoint"):
        parts.append(f"Primary endpoint: {row['primary_endpoint']}.")
    if row.get("efficacy_summary"):
        parts.append(str(row["efficacy_summary"]))

    result = {
        "kind": "trial",
        "id": nct_id,
        "title": indication or intervention or nct_id,
        "summary": " ".join(parts) if parts else f"No stored detail for {nct_id}.",
        "key_facts": {
            "phase": row.get("phase"),
            "n_enrolled": row.get("n_enrolled"),
            "indication": indication,
            "status": row.get("status"),
            "intervention": intervention,
            "primary_endpoint": row.get("primary_endpoint"),
        },
        "source_url": row.get("source_url") or f"https://clinicaltrials.gov/study/{nct_id}",
        "generated_by": "structured",
    }

    if use_llm:
        ext = _ctgov(nct_id)
        if ext and ext.get("brief"):
            prompt = (
                "Summarize this clinical trial for a clinician in 2-3 plain sentences. "
                "Cover design, population, and the primary outcome. No preamble, no markdown.\n\n"
                f"Title: {ext.get('title') or ''}\n"
                f"Summary: {ext['brief']}\n"
                f"Primary outcomes: {'; '.join(ext.get('outcomes') or []) or 'n/a'}"
            )
            llm = _claude(prompt)
            if llm:
                result["summary"] = llm
                result["generated_by"] = "llm"
            if ext.get("title"):
                result["title"] = ext["title"]
    return result


def summarize_paper(pmid: str, use_llm: bool = False) -> dict:
    rows = supabase.table("research_papers").select("*").eq("pmid", pmid).limit(1).execute().data
    row = rows[0] if rows else {}

    title = row.get("title") or f"PMID {pmid}"
    kind_label = "Narrative / review" if row.get("is_narrative") else "Primary study"
    structured = f"{title}. {row.get('journal') or ''} ({row.get('year') or 'n.d.'}). {kind_label}.".replace("  ", " ")

    result = {
        "kind": "paper",
        "id": pmid,
        "title": title,
        "summary": structured,
        "key_facts": {
            "journal": row.get("journal"),
            "year": row.get("year"),
            "is_narrative": row.get("is_narrative"),
        },
        "source_url": row.get("url") or f"https://pubmed.ncbi.nlm.nih.gov/{pmid}/",
        "generated_by": "structured",
    }

    if use_llm:
        abstract = _pubmed_abstract(pmid)
        if abstract:
            prompt = (
                "Summarize this paper for a clinician in 2-3 plain sentences. Cover what was studied, "
                "the finding, and any caveat. No preamble, no markdown.\n\n" + abstract
            )
            llm = _claude(prompt)
            if llm:
                result["summary"] = llm
                result["generated_by"] = "llm"
    return result


def summarize(nct: str | None = None, pmid: str | None = None, llm: bool = False) -> dict | None:
    if nct:
        return summarize_trial(nct.strip(), use_llm=llm)
    if pmid:
        return summarize_paper(pmid.strip(), use_llm=llm)
    return None
