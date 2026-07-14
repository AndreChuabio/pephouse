-- pephouse — vendor contact channels + member reports through the moderation queue.
--
-- Two changes, both driven by how this market actually works:
--
-- 1. Contact channels. The vendors people actually buy grey-market peptides from
--    operate on Telegram and WhatsApp, not websites. A missing website is not a
--    gap for them; the channel handle IS the storefront. So identity carries
--    telegram / whatsapp / a free-text other alongside website.
--
-- 2. Member reports move through the same moderation queue as vendor claims.
--    Before this, vendor claims were review-gated (vendor_submissions: pending ->
--    published) but member reports were read raw from user_reports with no gate,
--    which is an open astroturf vector: a vendor could post its own five-star
--    reviews or trash a rival. Now both a buyer report and a vendor claim land in
--    vendor_submissions as pending and appear publicly only after operator review.
--    `submission_kind` says which it is; the report_* columns carry a buyer's
--    report payload.
--
-- Append-only migration. Safe to re-run.

-- ── vendor_submissions: kind, report payload, contact channels ────────────────
alter table vendor_submissions
  add column if not exists submission_kind text not null default 'vendor'
    check (submission_kind in ('vendor', 'member')),
  -- attach a report/claim to an existing vendor at submission time (set from the
  -- vendor's own page); still nullable for a brand-new-vendor submission.
  add column if not exists report_compound_id bigint references compounds(id) on delete set null,
  add column if not exists report_sentiment text
    check (report_sentiment in ('positive', 'neutral', 'negative')),
  add column if not exists report_cost_usd numeric,
  add column if not exists report_batch_lab_tested boolean,
  -- contact channels, for vendors that have no website
  add column if not exists telegram text,
  add column if not exists whatsapp text,
  add column if not exists contact_other text;

comment on column vendor_submissions.submission_kind is
  'vendor = a self-disclosure/claim; member = a buyer report. Both are pending until reviewed.';

-- ── vendors: contact channels on the canonical row ────────────────────────────
alter table vendors
  add column if not exists telegram text,
  add column if not exists whatsapp text,
  add column if not exists contact_other text;

comment on column vendors.telegram is
  'Telegram handle or t.me link. Many grey-market sources have no website; the channel is the storefront.';
