-- Seed X (Twitter) anecdotes for Cellar / Database Explorer.
-- Uses INSERT ... SELECT so rows whose compound doesn't yet exist in
-- `compounds` are silently skipped (no error). Re-running creates
-- duplicates — there's no unique key on permalink yet.
--
-- Compounds expected: Tirzepatide, Semaglutide, BPC-157, Retatrutide,
-- CJC-1295, Ipamorelin, Tesamorelin, AOD-9604. Any missing compound
-- will just no-op silently.

-- Tirzepatide -----------------------------------------------------------------

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/liliancals/status/2069440084810846403',
  'i''ve been on mounjaro for a week now and i''ve only lost a kg and i''m barely eating, like BARELY OVER 3 BITES A DAY why does my body hate me',
  'Lost only 1kg in first week on Mounjaro with extreme appetite suppression',
  'negative', NULL, 'tier3_anecdote'
FROM compounds WHERE name = 'Tirzepatide';

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/theetweetur/status/2068819660175221193',
  'No shade I''m on mounjaro and this not eating shit is kinda scary. The last time I ate was 2pm yesterday and it was an oyster and 3 bites of pasta (on the positive side I''m only on week two and I''ve lost 11 pounds so there''s that)',
  'Lost 11lbs in ~2 weeks on Mounjaro but scary low appetite',
  'mixed', 'Week 2', 'tier3_anecdote'
FROM compounds WHERE name = 'Tirzepatide';

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/_shanaziaa/status/2068126751222317169',
  'Agreed! I lost so much weight on 5mg of Zepbound I don''t wanna go up and every check up they tell me it''s no need to bump up and you losing 1-3 pounds a week is normal',
  'Losing 1-3lbs/week on 5mg Zepbound (Tirzepatide)',
  'positive', '5mg', 'tier3_anecdote'
FROM compounds WHERE name = 'Tirzepatide';

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/UncleSamoyed/status/2067768767401103570',
  'I used tirzepatide for ~8 months while eating < 30 g carbs daily and doing 1 hour of personal training twice a week. I lost 105 lbs (240->135).',
  'Lost 105lbs in ~8 months on tirzepatide with diet + training',
  'positive', '~8 months', 'tier3_anecdote'
FROM compounds WHERE name = 'Tirzepatide';

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/underdog1030/status/2066170801263415685',
  'I''ve lost 7 pounds in 2 months on Mounjaro and I feel great. May not sound like much but I don''t lose easily or quickly ever.',
  'Lost 7lbs in 2 months on Mounjaro, feels great',
  'positive', '2 months', 'tier3_anecdote'
FROM compounds WHERE name = 'Tirzepatide';

-- Semaglutide -----------------------------------------------------------------

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/StoryandSpirit/status/2070498280598077573',
  'I mainly wanted to get my glucose under control... have been on them since Dec. I have lost about 18 lbs and have brought down my glucose... along with a mostly keto diet and exercise.',
  'Lost ~18lbs since Dec on compounded semaglutide + diet/exercise, better glucose',
  'positive', 'Compounded', 'tier3_anecdote'
FROM compounds WHERE name = 'Semaglutide';

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/lwfitzgerald/status/2070486517689016378',
  'I used compounded semaglutide for under $250/month, and recently switched to tirzepatide. I''ve had minimal to no side effects.',
  'Minimal/no side effects on compounded semaglutide',
  'positive', 'Compounded <$250/mo', 'tier3_anecdote'
FROM compounds WHERE name = 'Semaglutide';

-- BPC-157 ---------------------------------------------------------------------

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/dreyerdc/status/2070525928300490945',
  'I''ve been taking Barrier BPC-157... into month two now and see noticeable improvement in the elbow tendons where I had 5 months of pain...',
  'Noticeable improvement in elbow tendon pain after ~2 months',
  'positive', 'Month 2', 'tier3_anecdote'
FROM compounds WHERE name = 'BPC-157';

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/ascensionfather/status/2069637662030373172',
  'Pulled my biceps - probably tore something, BPC-157 knocked it out in a week w localized injections.',
  'Bicep injury resolved in 1 week with localized BPC-157 injections',
  'positive', '1 week localized', 'tier3_anecdote'
FROM compounds WHERE name = 'BPC-157';

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/Bhdreadnaught/status/2069538450299117875',
  'I blew the tendon in my arm... add vitamin C and collagen to go with BPC-157… within a month arm was good as new',
  'Arm tendon healed in ~1 month with BPC-157 + supp',
  'positive', '1 month', 'tier3_anecdote'
FROM compounds WHERE name = 'BPC-157';

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/WEBETE82/status/2069184247873654997',
  'I have been dealing with a chronic lower back pain due to a slipped disc for 12 years... After one month cycle i was healed completely.',
  'Chronic back pain healed after 1 month BPC-157 cycle',
  'positive', '1 month cycle', 'tier3_anecdote'
FROM compounds WHERE name = 'BPC-157';

-- Retatrutide -----------------------------------------------------------------

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/ppppptswy/status/2070887491880563014',
  'I lost a total of 20 kg using Retatrutide.',
  'Lost 20kg using Retatrutide',
  'positive', NULL, 'tier3_anecdote'
FROM compounds WHERE name = 'Retatrutide';

-- CJC-1295 --------------------------------------------------------------------

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/iliveulongtime/status/2070871014536282439',
  'CJC-1295 + ipamorelin... 250mcg of each every day... morning fasted... better recovery',
  'Better recovery/sleep with morning fasted dosing',
  'positive', '250mcg each daily', 'tier3_anecdote'
FROM compounds WHERE name = 'CJC-1295';

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/drcindyross/status/2070882931241836990',
  'CJC1295 with Ipamorelin. It boosts natural growth hormone for better sleep, recovery, lean muscle, and energy',
  'Better sleep/recovery/muscle on CJC1295 + Ipamorelin combo',
  'positive', NULL, 'tier3_anecdote'
FROM compounds WHERE name = 'CJC-1295';

-- Ipamorelin ------------------------------------------------------------------
-- Same tweet as the CJC-1295 entry above (the post discusses both stacks).

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/iliveulongtime/status/2070871014536282439',
  'CJC-1295 + ipamorelin... clean... without dragging up cortisol and prolactin',
  'Clean GH bump, good for recovery without sides',
  'positive', '250mcg with CJC', 'tier3_anecdote'
FROM compounds WHERE name = 'Ipamorelin';

-- Tesamorelin -----------------------------------------------------------------

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/127kgoflard/status/2070902245353226377',
  'Took my Tesa last night and dropped 600g',
  '600g drop overnight after Tesamorelin',
  'positive', NULL, 'tier3_anecdote'
FROM compounds WHERE name = 'Tesamorelin';

-- AOD-9604 --------------------------------------------------------------------

INSERT INTO anecdotes (compound_id, source, permalink, body, claimed_effect, sentiment, dose_mentioned, tier)
SELECT id, 'x',
  'https://x.com/itsjoshkade/status/2069918899421003802',
  '500mcg daily fasted pre-cardio... targeted fat mobilization',
  'Targeted stubborn fat loss with 500mcg pre-cardio',
  'positive', '500mcg daily', 'tier3_anecdote'
FROM compounds WHERE name = 'AOD-9604';
