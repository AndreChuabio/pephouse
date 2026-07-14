-- pephouse — vendor registry: submissions and community reports
--
-- The vendor index is an EDUCATION surface, not a storefront. Two invariants
-- hold it up, and both are enforced here rather than by policy:
--
--   1. No vendor money touches this data. There is no price, placement, or
--      ranking column, and no table in this file has one. A vendor cannot buy a
--      listing, a position, or a rating. Submitting data buys transparency and
--      nothing else.
--
--   2. A vendor's own certificate of analysis is NOT an independent assay.
--      Vendor-submitted numbers land here, tagged `vendor_submitted`, and are
--      rendered distinctly from third-party lab results in `vendor_lab_results`.
--      They never silently become "tested".
--
-- Append-only migration; source of truth for these tables. Safe to re-run.

-- ── vendor_submissions ───────────────────────────────────────────────────────
-- What a vendor tells us about itself, captured at a booth or via the web form.
-- Published with provenance; never presented as verified.
create table if not exists vendor_submissions (
  id                  bigint generated always as identity primary key,
  created_at          timestamptz not null default now(),

  -- Identity as claimed by the submitter.
  vendor_name         text not null,
  manufacturer        text,
  country             text,
  source_type         source_type,
  website             text,

  -- Testing claims. `third_party_tested` is a CLAIM until an assay backs it;
  -- the UI must say so. test_labs is who they say tested them.
  third_party_tested  boolean,
  test_labs           text[],
  coa_url             text,
  gmp_certified       boolean,

  -- Free-text context and who submitted it (a vendor rep, or a member reporting
  -- a source they use). Kept because the two carry different credibility.
  submitted_by        text not null default 'vendor'
                        check (submitted_by in ('vendor', 'member', 'operator')),
  submitter_ref       text,
  notes               text,

  -- Review state. Nothing is published until an operator has looked at it, so a
  -- competitor cannot smear a rival by submitting a fake damning entry, and a
  -- vendor cannot inflate itself with an invented COA.
  status              text not null default 'pending'
                        check (status in ('pending', 'published', 'rejected')),
  review_note         text,
  -- Set when this submission has been reconciled onto a canonical vendors row.
  vendor_id           bigint references vendors(id) on delete set null
);

comment on table vendor_submissions is
  'Vendor self-disclosure and member source reports. Data here is CLAIMED, not verified. It is published tagged as vendor-submitted and is never rendered as an independent assay. No vendor may pay for a listing or a position.';

comment on column vendor_submissions.third_party_tested is
  'A claim by the submitter, not a verified fact. Only a row in vendor_lab_results is evidence of independent testing.';

create index if not exists vendor_submissions_status_idx
  on vendor_submissions (status, created_at desc);

create index if not exists vendor_submissions_vendor_idx
  on vendor_submissions (vendor_id);

-- One pending submission per vendor name keeps a booth queue from filling with
-- duplicates of the same walk-up.
create unique index if not exists vendor_submissions_pending_name_idx
  on vendor_submissions (lower(vendor_name))
  where status = 'pending';

-- ── row level security ───────────────────────────────────────────────────────
-- Written through the backend with the service-role key. Anon has no direct
-- access: submissions arrive via POST /vendors/submissions, which authenticates
-- the caller and records who submitted what.
alter table vendor_submissions enable row level security;

do $$ begin
  create policy "service_role full access" on vendor_submissions
    for all
    to service_role
    using (true)
    with check (true);
exception when duplicate_object then null; end $$;
