-- Use only if the database holds data worth keeping.
-- On Day 1 prefer reset.sql.
--
-- supabase/migrations/001_v1_1.sql — v1.0 -> v1.1, non-destructive.
-- Owner: TM3. Paste into the Supabase SQL editor and run.
--
-- What this does:
--   1. Adds every CHECK constraint the v1.1 schema declares. v1.0 had none —
--      zod in types/contract.ts was the only enforcement, which means anything
--      that reached the database by another route was never checked.
--   2. Repairs the golden-path cases row so S3 actually moves (v1.0 seeded the
--      hearing 3 days out and the intimidation report 5 days ago, which put
--      both time-windowed rows INSIDE their windows on every historical
--      check-in — the flat baseline was arithmetically impossible).
--   3. Clears A-4471's stored baseline so scripts/seed.ts recomputes it from
--      lib/scoring/baseline.ts rather than inheriting the v1.0 numbers.
--
-- Each constraint is dropped-if-exists first, so this file is safe to re-run.
--
-- IF A CONSTRAINT FAILS TO ADD, a row already violates it. That is a finding,
-- not an obstacle: read the offending row before you delete it. Do not weaken
-- the constraint to make the statement pass.

begin;

-- ── 1. CHECK constraints ─────────────────────────────────────────────────

-- persons
alter table persons drop constraint if exists persons_language_check;
alter table persons add  constraint persons_language_check
  check (language in ('en','hi'));

-- cases
alter table cases drop constraint if exists cases_stage_check;
alter table cases add  constraint cases_stage_check
  check (stage in ('investigation','trial','rehabilitation','compensation'));

alter table cases drop constraint if exists cases_bail_status_check;
alter table cases add  constraint cases_bail_status_check
  check (bail_status in ('not_applicable','accused_in_custody','accused_on_bail'));

-- consents
alter table consents drop constraint if exists consents_capture_method_check;
alter table consents add  constraint consents_capture_method_check
  check (capture_method in ('tap','voice_simulated'));

-- checkins
alter table checkins drop constraint if exists checkins_channel_check;
alter table checkins add  constraint checkins_channel_check
  check (channel in ('chat','call_sim'));

-- assessments
alter table assessments drop constraint if exists assessments_tier_check;
alter table assessments add  constraint assessments_tier_check
  check (tier in ('GREEN','AMBER','RED','CRITICAL'));

alter table assessments drop constraint if exists assessments_trigger_source_check;
alter table assessments add  constraint assessments_trigger_source_check
  check (trigger_source in ('policy','lexicon','panic_key','self_report_q3'));

-- alerts — note the narrower set: a GREEN never produces an alert row.
alter table alerts drop constraint if exists alerts_tier_check;
alter table alerts add  constraint alerts_tier_check
  check (tier in ('AMBER','RED','CRITICAL'));

-- audit_events
alter table audit_events drop constraint if exists audit_events_role_check;
alter table audit_events add  constraint audit_events_role_check
  check (role in ('counsellor','operator','admin'));

alter table audit_events drop constraint if exists audit_events_action_check;
alter table audit_events add  constraint audit_events_action_check
  check (action in ('view_queue','view_person','ack_alert','dispose'));

-- ── 2. golden-path dates ─────────────────────────────────────────────────
-- Both time-windowed S3 rows must be OUTSIDE their windows on D-3 and D-2 and
-- INSIDE on D0. Hearing at D+6 is 9 days out at D-3; the intimidation report
-- is filed on D-1. Static rows (bail, relief, adjournments, case age) total 50
-- and stay deliberately under the s3_gte:60 RED rule.
update cases
   set next_hearing_date        = current_date + 6,
       last_intimidation_report = current_date - 1
 where person_id = '11111111-1111-1111-1111-111111111111';

-- ── 3. clear the stored baseline ─────────────────────────────────────────
-- Scoped to A-4471 on purpose. Nulling every person's baseline would destroy
-- exactly the data this file exists to preserve — if you genuinely want a
-- global reset, you want reset.sql.
update persons
   set baseline_mean = null,
       baseline_var  = null
 where id = '11111111-1111-1111-1111-111111111111';

commit;

-- Then: npm run seed
