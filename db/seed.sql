-- pephouse seed data — real verified rows so the registry works immediately.
-- Run after schema.sql.

insert into compounds (name, aliases, drug_class, fda_status, approved, summary) values
('BPC-157', '{Bepecin,PCO-02}', 'synthetic peptide', 'category_2_bulk', false,
 'Hyped healing peptide. ~all evidence preclinical; only 2 registered human trials ever. WADA-banned.'),
('Semaglutide', '{Wegovy,Ozempic}', 'GLP-1 receptor agonist', 'approved', true,
 'FDA-approved. Robust RCT base (SELECT). The benchmark every meme peptide is measured against.'),
('Tirzepatide', '{Mounjaro,Zepbound}', 'GLP-1/GIP agonist', 'approved', true,
 'FDA-approved. Outperformed semaglutide head-to-head (SURMOUNT-5).'),
('TB-500', '{Thymosin beta-4,TB4}', 'peptide fragment', 'research_only', false,
 'Tissue-repair peptide. Only tiny early-phase ophthalmic trials; not approved. WADA-banned.'),
('Ipamorelin', '{}', 'growth hormone secretagogue', 'research_only', false,
 'GH secretagogue. No registered human efficacy trials surfaced; not approved. WADA-banned (S2).'),
('CJC-1295', '{CJC1295,DAC:GRF}', 'GHRH analogue', 'research_only', false,
 'GHRH analogue, often stacked with ipamorelin. Not approved. WADA-banned (S2).'),
('Thymosin alpha-1', '{Thymalfasin,Zadaxin}', 'immunomodulatory peptide', 'research_only', false,
 'Approved in several countries (Zadaxin) but not FDA-approved. Phase 3 sepsis trial (TESTS) was negative.'),
('Tesamorelin', '{Egrifta}', 'GHRH analogue', 'approved', true,
 'FDA-approved (Egrifta) for HIV lipodystrophy. Raises IGF-1 within normal range; no glycemic worsening.'),
('Melanotan II', '{MT-II,MT2}', 'melanocortin agonist', 'research_only', false,
 'Tanning/libido peptide with documented harms (nausea, priapism, mole darkening). Not approved.'),
('GHK-Cu', '{Copper peptide}', 'copper-binding peptide', 'research_only', false,
 'Copper tripeptide marketed cosmetically. Not approved as a drug for systemic use.'),
('Sermorelin', '{Geref}', 'GHRH analogue', 'research_only', false,
 'Former FDA-approved GHRH analogue (Geref), withdrawn from US market; now compounded/research use.'),
('Retatrutide', '{LY3437943}', 'GLP-1/GIP/glucagon agonist', 'research_only', false,
 'Investigational triple agonist (Eli Lilly). In Phase 3; not yet approved.')
on conflict (name) do nothing;

-- Tier-1 trials are loaded by scripts/ingest_clinicaltrials.py (real CT.gov data).

insert into trials (compound_id, nct_id, phase, indication, status, n_enrolled, efficacy_summary, source_url) values
((select id from compounds where name='BPC-157'), 'NCT07437547', 'Phase 2', 'Grade II hamstring strain', 'recruiting (Feb 2026)', 120, 'First efficacy trial; no results yet', 'https://clinicaltrials.gov/study/NCT07437547'),
((select id from compounds where name='BPC-157'), 'NCT02637284', 'Phase 1', 'PK/safety', 'cancelled 2016', 42, 'Withdrawn before review; no efficacy data', 'https://clinicaltrials.gov/study/NCT02637284'),
((select id from compounds where name='Semaglutide'), 'NCT03574597', 'Phase 3', 'CVD + obesity (SELECT)', 'completed', 17604, '-10.2% vs -1.5% weight at 4yr; 20% MACE reduction (HR 0.80)', 'https://www.nature.com/articles/s41591-024-02996-7');

insert into evidence_facts (compound_id, fact, source_url) values
((select id from compounds where name='BPC-157'), 'FDA classified BPC-157 as a Category 2 bulk drug substance in Sept 2023, barring it from compounding. WADA-banned since Jan 2022.', 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11859134/'),
((select id from compounds where name='BPC-157'), 'No approval-grade human efficacy trials exist; evidence base is almost entirely preclinical (rat) studies.', 'https://pmc.ncbi.nlm.nih.gov/articles/PMC12446177/'),
((select id from compounds where name='Semaglutide'), 'SELECT trial (N=17,604): -10.2% vs -1.5% weight at 208 weeks; 20% reduction in major adverse cardiac events (HR 0.80).', 'https://www.nature.com/articles/s41591-024-02996-7');

insert into outcome_priors (compound_id, outcome_name, effect_mean, effect_sd, unit, population_n, source_trial_id) values
((select id from compounds where name='Semaglutide'), 'weight_change_pct', -10.2, 5.0, 'percent', 17604,
 (select id from trials where nct_id='NCT03574597'));

insert into vendor_lab_results (compound_id, vendor_name, finnrick_rating, purity_pct, label_mg, tested_mg, quantity_variance_pct, batch_id, lab_id, test_date, source_url) values
((select id from compounds where name='Tirzepatide'), 'LSPL', 'C', 99.80, 30, 28.7, -4.3, 'BBG70', 'Lab E', '2026-06-02', 'https://www.finnrick.com/vendors/lspl');
