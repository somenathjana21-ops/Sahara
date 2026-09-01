/**
 * scripts/seed.ts — TM3 owner
 *
 * Seeds the golden-path persona (A-4471) plus filler data for the queue.
 * Idempotent: running twice produces the same state (CHECKS_TM3 T3-B1).
 *
 * Golden path: flat, flat, spike
 * - Day -3: S3 50, composite 28.00 → GREEN
 * - Day -2: S3 50, composite 31.00 → GREEN (baseline: μ=28.90, σ²=8)
 * - Day -1: intimidation report filed, hearing enters 7-day window
 * - Day 0 (LIVE): S3 90, composite 53.75, z=3.11 → RED
 *
 * Only the first TWO check-ins are seeded. The third happens live on stage.
 */


import { createClient } from '@supabase/supabase-js';
import { updateEWMA } from '../lib/scoring/baseline';

// Load .env.local


const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Golden path persona ID (fixed for reproducibility)
const GOLDEN_PERSON_ID = '11111111-1111-1111-1111-111111111111';
const GOLDEN_CASE_ID = '11111111-1111-1111-1111-111111111112';
const GOLDEN_CONSENT_ID = '11111111-1111-1111-1111-111111111113';

async function main() {
  console.log('🌱 Seeding database (upsert mode)...');

  // Insert or update golden-path persona
  console.log('Upserting golden-path persona A-4471...');

  // Dynamically compute baseline from the two prior check-in composites
  // using the same EWMA function the scoring engine uses.
  const composite1 = 28.00;
  const composite2 = 31.00;
  const after1 = updateEWMA(null, null, composite1);          // mu=28, var=0
  const after2 = updateEWMA(after1.mean, after1.variance, composite2); // EWMA update

  const { error: personError } = await supabase.from('persons').upsert({
    id: GOLDEN_PERSON_ID,
    pseudonym: 'A-4471',
    language: 'hi',
    is_minor_flag: false,
    baseline_mean: after2.mean,      // Computed dynamically via EWMA
    baseline_var: after2.variance,   // Computed dynamically via EWMA
    checkin_count: 2,
    missed_count: 0,
    created_at: new Date('2026-08-28T09:00:00Z').toISOString(),
  });

  if (personError) throw personError;

  // Insert or update case (S3 signal source)
  const hearingDate = new Date('2026-09-06'); // Day 0 + 6 days

  const { error: caseError } = await supabase.from('cases').upsert({
    id: GOLDEN_CASE_ID,
    person_id: GOLDEN_PERSON_ID,
    atrocity_category: 'Land Dispossession',
    stage: 'trial',
    next_hearing_date: hearingDate.toISOString().split('T')[0],
    adjournment_count: 4,
    bail_status: 'accused_on_bail',
    relief_due_date: '2026-06-30', // 62 days overdue
    relief_paid: false,
    social_boycott_flag: false,
    last_intimidation_report: '2026-08-30', // Yesterday (Day -1)
    opened_at: '2025-03-15',
  });

  if (caseError) throw caseError;

  // Insert or update consent
  const { error: consentError } = await supabase.from('consents').upsert({
    id: GOLDEN_CONSENT_ID,
    person_id: GOLDEN_PERSON_ID,
    purpose: 'distress_monitoring',
    capture_method: 'tap',
    granted_at: new Date('2026-08-28T08:55:00Z').toISOString(),
    withdrawn_at: null,
  });

  if (consentError) throw consentError;

  // Check-in 1 (Day -3: composite 28.00, S3=50)
  console.log('Upserting check-in 1 (Day -3)...');
  const checkin1Id = '11111111-1111-1111-1111-111111111114';
  const { error: checkin1Error } = await supabase.from('checkins').upsert({
    id: checkin1Id,
    person_id: GOLDEN_PERSON_ID,
    consent_id: GOLDEN_CONSENT_ID,
    channel: 'chat',
    transcript: 'मैं ठीक हूं। बस थोड़ी चिंता है।',
    structured: { q1: 2, q2: 2, q3: 1 },
    abandoned: false,
    created_at: new Date('2026-08-28T09:00:00Z').toISOString(),
  });

  if (checkin1Error) throw checkin1Error;

  const { error: assessment1Error } = await supabase.from('assessments').upsert({
    id: '11111111-1111-1111-1111-111111111115',
    checkin_id: checkin1Id,
    person_id: GOLDEN_PERSON_ID,
    components: { s1: 50, s2: 30, s3: 50, s4: 0, s5: 20 },
    contributions: { s1: 17.5, s2: 7.5, s3: 12.5, s4: 0, s5: 0 },
    composite: 28.00,
    z_score: null, // No baseline yet
    change_point: false,
    tier: 'GREEN',
    trigger_source: 'policy',
    explanation: ['S3: Hearing in 90+ days', 'S1: Moderate self-report'],
    policy_version: 'v1',
    model_version: 'llama-3.3-70b',
    created_at: new Date('2026-08-28T09:00:30Z').toISOString(),
  });

  if (assessment1Error) throw assessment1Error;

  // Check-in 2 (Day -2: composite 31.00, S3=50)
  console.log('Upserting check-in 2 (Day -2)...');
  const checkin2Id = '11111111-1111-1111-1111-111111111116';
  const { error: checkin2Error } = await supabase.from('checkins').upsert({
    id: checkin2Id,
    person_id: GOLDEN_PERSON_ID,
    consent_id: GOLDEN_CONSENT_ID,
    channel: 'chat',
    transcript: 'नींद ठीक से नहीं आ रही।',
    structured: { q1: 2, q2: 3, q3: 1 },
    abandoned: false,
    created_at: new Date('2026-08-29T10:00:00Z').toISOString(),
  });

  if (checkin2Error) throw checkin2Error;

  const { error: assessment2Error } = await supabase.from('assessments').upsert({
    id: '11111111-1111-1111-1111-111111111117',
    checkin_id: checkin2Id,
    person_id: GOLDEN_PERSON_ID,
    components: { s1: 58, s2: 35, s3: 50, s4: 0, s5: 25 },
    contributions: { s1: 20.3, s2: 8.75, s3: 12.5, s4: 0, s5: 0 },
    composite: 31.00,
    z_score: 0.375, // (31 - 28.90) / sqrt(8)
    change_point: false,
    tier: 'GREEN',
    trigger_source: 'policy',
    explanation: ['S3: Hearing in 90+ days', 'S1: Moderate self-report', 'Sleep disturbance noted'],
    policy_version: 'v1',
    model_version: 'llama-3.3-70b',
    created_at: new Date('2026-08-29T10:00:30Z').toISOString(),
  });

  if (assessment2Error) throw assessment2Error;

  // NOTE: Check-in 3 (Day 0) is NOT seeded. It happens LIVE during the demo.
  // When it does, S3 will jump to 90 (hearing in 6 days + intimidation yesterday),
  // composite will be ~53.75, z-score 3.11, triggering RED alert.

  console.log('✅ Golden path seeded (2 check-ins, baseline set)');
  console.log('   Persona: A-4471 (Hindi, land dispossession)');
  console.log(`   Baseline: μ=${after2.mean.toFixed(2)}, σ²=${after2.variance.toFixed(2)}`);
  console.log('   Next check-in (Day 0) will spike to RED');

  // Add some filler personas for queue variety
  console.log('\n🔢 Adding filler personas...');
  await seedFillers();

  console.log('\n✅ Seed complete!');
}

/**
 * Deterministic per-filler UUIDs.
 *
 * The last group is twelve hex characters: nine '2's, a one-character SLOT that
 * says which table the row belongs to, then the two-digit filler index.
 *
 * This replaces `filler.id.replace('01', '11')`. That only ever rewrote the
 * FIRST occurrence of the literal "01", which exists in filler 01's id and in
 * none of the others — so fillers 02-08 got a consent, a check-in, an
 * assessment and an alert whose primary key was the PERSON's uuid. They landed
 * in different tables so nothing errored, but the ids meant nothing, and a
 * `cases` row derived the same way would have collided with the person id.
 */
function fillerUuid(slot: string, index: number): string {
  const nn = String(index + 1).padStart(2, '0');
  return `22222222-2222-2222-2222-${'2'.repeat(9)}${slot}${nn}`;
}

const SLOT = {
  person: '2', // '...222222222201' — unchanged, so persons still upsert in place
  consent: '1',
  checkin: '3',
  assessment: '4',
  alert: '5',
  case: '6',
} as const;

async function seedFillers() {
  const fillers = [
    { pseudonym: 'A-2301', tier: 'GREEN', composite: 15.5 },
    { pseudonym: 'A-3492', tier: 'GREEN', composite: 22.0 },
    { pseudonym: 'A-5671', tier: 'AMBER', composite: 42.0 },
    { pseudonym: 'A-7834', tier: 'GREEN', composite: 18.5 },
    { pseudonym: 'A-9123', tier: 'AMBER', composite: 38.0 },
    { pseudonym: 'A-1245', tier: 'GREEN', composite: 25.0 },
    { pseudonym: 'A-4567', tier: 'AMBER', composite: 45.0 },
    { pseudonym: 'A-8901', tier: 'GREEN', composite: 12.0 },
    /*
     * The minor. `is_minor_flag` routes every check-in straight to a human and
     * NOTHING is scored (CLAUDE.md rule 10, SAFETY_SPEC.md S10), which is why
     * this persona deliberately gets no check-in, no assessment and no alert:
     * a minor carrying an assessment row would contradict the rule the row
     * exists to demonstrate, and would put them in the triage queue.
     *
     * Their purpose is to give T1-C10 a live target — POST a check-in for this
     * person and expect the minor reply, a `checkins` row, and zero
     * `assessments` rows. The eight above stay scored so the queue still shows
     * eight fillers across varied tiers (T3-B5).
     */
    { pseudonym: 'A-6218', tier: 'GREEN', composite: 0, isMinor: true },
  ] as const;

  // Dull, non-identifying case context. Every filler needs one: the staff read
  // path throws "person <id> has no case row" without it and the person detail
  // 500s, which is what CHECKS_TM3 T3-C1/T3-B5 walk straight into from the
  // queue. S3 is computed from these columns, so they must be plausible.
  const stages = ['investigation', 'trial', 'rehabilitation', 'compensation'] as const;
  const categories = [
    'Property — Land Dispossession',
    'Property — Forced Eviction',
    'Social — Boycott',
    'Physical — Assault',
  ] as const;

  for (const [index, filler] of fillers.entries()) {
    const personId = fillerUuid(SLOT.person, index);
    const consentId = fillerUuid(SLOT.consent, index);
    const checkinId = fillerUuid(SLOT.checkin, index);
    const assessmentId = fillerUuid(SLOT.assessment, index);
    const isMinor = 'isMinor' in filler && filler.isMinor === true;

    await supabase.from('persons').upsert({
      id: personId,
      pseudonym: filler.pseudonym,
      language: 'hi',
      is_minor_flag: isMinor,
      // A minor is never scored, so they have no baseline to carry.
      baseline_mean: isMinor ? null : filler.composite,
      baseline_var: isMinor ? null : 5.0,
      checkin_count: isMinor ? 0 : 1,
    });

    await supabase.from('cases').upsert({
      id: fillerUuid(SLOT.case, index),
      person_id: personId,
      atrocity_category: categories[index % categories.length],
      stage: stages[index % stages.length],
      // Far outside the 7-day window, so no filler accidentally scores like
      // the golden path (SCORING_AND_POLICY.md section 5, S3 row 3).
      next_hearing_date: '2026-12-15',
      adjournment_count: index % 3,
      bail_status: 'not_applicable',
      relief_due_date: null,
      relief_paid: true,
      social_boycott_flag: false,
      last_intimidation_report: null,
      opened_at: '2026-02-01',
    });

    await supabase.from('consents').upsert({
      id: consentId,
      person_id: personId,
      capture_method: 'tap',
    });

    // A minor is routed to a human, never scored: no check-in, no assessment,
    // no alert, and so no row in the triage queue.
    if (isMinor) continue;

    await supabase.from('checkins').upsert({
      id: checkinId,
      person_id: personId,
      consent_id: consentId,
      channel: 'chat',
      structured: { q1: 1, q2: 1, q3: 0 },
    });

    await supabase.from('assessments').upsert({
      id: assessmentId,
      checkin_id: checkinId,
      person_id: personId,
      components: { s1: 30, s2: 20, s3: 25, s4: 0, s5: 15 },
      contributions: { s1: 10.5, s2: 5.0, s3: 6.25, s4: 0, s5: 0 },
      composite: filler.composite,
      z_score: null,
      change_point: false,
      tier: filler.tier,
      trigger_source: 'policy',
      explanation: ['Normal check-in'],
      policy_version: 'v1',
      model_version: 'llama-3.3-70b',
    });

    // Create alerts for AMBER cases
    if (filler.tier === 'AMBER') {
      await supabase.from('alerts').upsert({
        id: fillerUuid(SLOT.alert, index),
        assessment_id: assessmentId,
        person_id: personId,
        tier: 'AMBER',
        sla_minutes: 1440, // 24 hours
      });
    }
  }

  const minors = fillers.filter((f) => 'isMinor' in f && f.isMinor === true);
  console.log(
    `   Added ${fillers.length} filler personas ` +
      `(${fillers.length - minors.length} scored, ${minors.length} minor, all with a case row)`,
  );
}

main().catch(console.error);
