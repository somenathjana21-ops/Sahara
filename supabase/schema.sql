-- SIH 26094 MVP — Supabase schema  v1.1
-- Owner: TM3. Applied on Day 0. This is the contract between all three members.
--
-- v1.1 changes: CHECK constraints added (zod was the only enforcement);
-- golden-path seed timeline corrected so S3 actually moves. See
-- FIXES_AND_PROMPTS.md §1.
--
-- NO PII. No names, phones, emails, addresses, or real case numbers.
-- Persons are pseudonyms like 'A-4471'. If you are about to add a column
-- that could hold a real identity, don't.

-- ── people ────────────────────────────────────────────────────────────────
create table persons (
  id              uuid primary key default gen_random_uuid(),
  pseudonym       text not null unique,          -- 'A-4471'
  language        text not null default 'en'
                  check (language in ('en','hi')),
  is_minor_flag   boolean not null default false,-- true => human route, NO scoring
  baseline_mean   numeric,                       -- EWMA μ, null until 1st check-in
  baseline_var    numeric,                       -- EWMA σ²
  checkin_count   int not null default 0,
  missed_count    int not null default 0,
  created_at      timestamptz not null default now()
);

-- ── case context: the S3 signal source ───────────────────────────────────
create table cases (
  id                      uuid primary key default gen_random_uuid(),
  person_id               uuid not null references persons(id) on delete cascade,
  atrocity_category       text not null,   -- from the case taxonomy
  stage                   text not null
                          check (stage in ('investigation','trial',
                                           'rehabilitation','compensation')),
  next_hearing_date       date,
  adjournment_count       int  not null default 0,
  bail_status             text not null default 'not_applicable'
                          check (bail_status in ('not_applicable',
                                                 'accused_in_custody',
                                                 'accused_on_bail')),
  relief_due_date         date,
  relief_paid             boolean not null default false,
  social_boycott_flag     boolean not null default false,
  last_intimidation_report date,
  opened_at               date not null default current_date
);

-- ── consent: no scoring may occur without a live row here ────────────────
create table consents (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references persons(id) on delete cascade,
  purpose        text not null default 'distress_monitoring',
  capture_method text not null
                 check (capture_method in ('tap','voice_simulated')),
  granted_at     timestamptz not null default now(),
  withdrawn_at   timestamptz
);

-- ── check-ins: one row per interaction, any channel ──────────────────────
create table checkins (
  id          uuid primary key default gen_random_uuid(),
  person_id   uuid not null references persons(id) on delete cascade,
  consent_id  uuid references consents(id),
  channel     text not null check (channel in ('chat','call_sim')),
  transcript  text,
  structured  jsonb not null default '{}', -- { q1, q2, q3 }
  abandoned   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- ── assessments: the scored output ───────────────────────────────────────
create table assessments (
  id             uuid primary key default gen_random_uuid(),
  checkin_id     uuid not null references checkins(id) on delete cascade,
  person_id      uuid not null references persons(id) on delete cascade,
  components     jsonb not null,           -- { s1,s2,s3,s4,s5 } each 0-100 or null
                                           -- SNAPSHOT at check-in time, never recomputed
  contributions  jsonb not null,           -- weighted values, for the breakdown chart
  composite      numeric not null,
  z_score        numeric,
  change_point   boolean not null default false,
  tier           text not null
                 check (tier in ('GREEN','AMBER','RED','CRITICAL')),
  trigger_source text not null
                 check (trigger_source in ('policy','lexicon',
                                           'panic_key','self_report_q3')),
  explanation    jsonb not null default '[]',
  policy_version text not null,
  model_version  text not null,
  created_at     timestamptz not null default now()
);

-- ── alerts: ack-required, never silent-fail ──────────────────────────────
create table alerts (
  id            uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  person_id     uuid not null references persons(id) on delete cascade,
  tier          text not null check (tier in ('AMBER','RED','CRITICAL')),
  sla_minutes   int  not null,
  created_at    timestamptz not null default now(),
  acked_at      timestamptz,
  acked_by      text,
  disposition   text check (disposition in ('contacted','no_action_needed',
                                            'escalated','pending'))
);

-- ── audit: every staff-side read of person data ──────────────────────────
create table audit_events (
  id         uuid primary key default gen_random_uuid(),
  actor      text not null,
  role       text not null
             check (role in ('counsellor','operator','admin')),
  action     text not null
             check (action in ('view_queue','view_person','ack_alert','dispose')),
  subject_id uuid,
  created_at timestamptz not null default now()
);

create index on checkins    (person_id, created_at desc);
create index on assessments (person_id, created_at desc);
create index on alerts      (acked_at, created_at desc);

-- ── RLS: lock the anon key out of everything ─────────────────────────────
-- All access goes through Next.js route handlers using the service-role key,
-- server-side only. The browser never talks to Supabase directly.
alter table persons      enable row level security;
alter table cases        enable row level security;
alter table consents     enable row level security;
alter table checkins     enable row level security;
alter table assessments  enable row level security;
alter table alerts       enable row level security;
alter table audit_events enable row level security;
-- No policies defined => anon and authenticated roles get nothing.
-- The service-role key bypasses RLS. Never expose it to the client.
-- If something needs a policy to work, the something is wrong, not the RLS.


-- ═════════════════════════════════════════════════════════════════════════
-- GOLDEN PATH SEED — the 90 seconds the whole demo rests on.
--
-- Authoritative version is scripts/seed.ts (idempotent, and it COMPUTES the
-- baseline from lib/scoring/baseline.ts rather than hardcoding it). This
-- block is the reference for what that script must produce.
--
-- TIMELINE — the whole point is that S3 MOVES:
--
--            D-3        D-2         D-1              D0 (live)
--   S3        50         50      [events fire]        90
--   composite 28.00      31.00                        53.75
--   tier      GREEN      GREEN                        RED (z = 3.11)
--
--   static rows, constant throughout      = 50
--     bail +20 · relief overdue +15 · adjournments +10 · case age +5
--   time-windowed rows, both flip on D-1  = +40
--     intimidation report filed D-1  → +25
--     hearing D+6 enters the 7-day window → +15
--
-- Static total is 50, deliberately under the s3_gte:60 RED threshold.
-- If you raise it past 60 the flat baseline turns RED and the demo dies.
-- ═════════════════════════════════════════════════════════════════════════

insert into persons (id, pseudonym, language, checkin_count)
values ('11111111-1111-1111-1111-111111111111', 'A-4471', 'hi', 2);
-- baseline_mean / baseline_var are INTENTIONALLY omitted here.
-- scripts/seed.ts computes them: μ = 28.90, σ² = 2.70 (σ = 1.64, floored to 8).
-- Hardcoding them means the demo isn't reproducible from the real code path,
-- and "where does 28.9 come from?" gets a bad answer on stage. See CHECKS_TM3 T3-B2.

insert into cases (person_id, atrocity_category, stage, next_hearing_date,
                   adjournment_count, bail_status, relief_due_date, relief_paid,
                   social_boycott_flag, last_intimidation_report, opened_at)
values ('11111111-1111-1111-1111-111111111111',
        'Property - Land Dispossession', 'trial',
        current_date + 6,      -- hearing: 9d out at D-3, 6d out at D0  → +15 only at D0
        4,                     -- 4th adjournment                        → +10 always
        'accused_on_bail',     -- accused out on bail                    → +20 always
        current_date - 62, false,  -- relief 62 days late                → +15 always
        false,                 -- no social boycott flag                 → +0
        current_date - 1,      -- intimidation filed YESTERDAY           → +25 only at D0
        current_date - 400);   -- case open 400 days                     → +5 always

insert into consents (id, person_id, capture_method)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'voice_simulated');

-- Two prior check-ins + assessments, inserted by scripts/seed.ts:
--   D-3: structured {q1:1,q2:1,q3:1}  components {s1:25,s2:27,s3:50,s4:0,s5:null}
--        composite 28.00  z null  change_point false  tier GREEN
--   D-2: structured {q1:1,q2:1,q3:1}  components {s1:25,s2:39,s3:50,s4:0,s5:null}
--        composite 31.00  z 0.375 change_point false  tier GREEN
--
-- NOTE the s3:50 in both. S3 is a SNAPSHOT at check-in time. Do not recompute
-- it from today's cases row — today it is 90, and the trend chart would lie.
--
-- The third check-in is NOT seeded. It is created live on stage.
