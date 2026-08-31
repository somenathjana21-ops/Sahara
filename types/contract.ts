/**
 * types/contract.ts — the seam.
 *
 * Owner: TM1. FROZEN after Day 0 (00_MVP_PLAN.md section 5).
 * Changes need TM1 sign-off and a message in the group.
 *
 * CHANGE LOG since the freeze:
 *   Day 4 — CheckInResponse.tier and .assessmentId became optional, so the
 *           minor route can omit both instead of inventing them. Signed off by
 *           TM1; see the block comment on CheckInResponseSchema.
 *
 * Implements: 00_MVP_PLAN.md section 5, TM1_GUIDE.md section 3 (Prompt 2).
 * Row schemas match schema.sql column-for-column, in snake_case.
 * API payloads (CheckInRequest/Response, QueueItem, PersonDetail) are
 * camelCase, as specified. That split is deliberate: rows are database rows,
 * payloads are wire format.
 *
 * NO PII. There is no name, phone, email, address, or real case number in any
 * schema below, and none may be added. Persons are pseudonyms like 'A-4471'.
 *
 * Types only. No logic. Nothing imported from lib/.
 */

import { z } from "zod";

/* ── primitives ──────────────────────────────────────────────────────────── */

/**
 * z.guid(), not z.uuid(). zod 4's z.uuid() enforces the RFC 9562 version and
 * variant bits, which rejects the golden-path seed IDs in schema.sql
 * ('11111111-1111-1111-1111-111111111111'). Postgres accepts them, so we must
 * too, or scripts/seed.ts fails validation and the demo dies.
 */
export const UuidSchema = z.guid();
export type Uuid = z.infer<typeof UuidSchema>;

/** Postgres timestamptz, as PostgREST serialises it: ISO 8601 with an offset. */
export const TimestamptzSchema = z.iso.datetime({ offset: true });
export type Timestamptz = z.infer<typeof TimestamptzSchema>;

/** Postgres date, as PostgREST serialises it: 'YYYY-MM-DD'. */
export const DateOnlySchema = z.iso.date();
export type DateOnly = z.infer<typeof DateOnlySchema>;

/* ── enums ───────────────────────────────────────────────────────────────── */

export const TierSchema = z.enum(["GREEN", "AMBER", "RED", "CRITICAL"]);
export type Tier = z.infer<typeof TierSchema>;

export const ChannelSchema = z.enum(["chat", "call_sim"]);
export type Channel = z.infer<typeof ChannelSchema>;

/**
 * Only 'lexicon' | 'panic_key' | 'self_report_q3' may produce CRITICAL
 * (SAFETY_SPEC.md section 3). 'policy' is the composite/tier path and cannot.
 * That rule is enforced in lib/, not here — this file has no logic.
 */
export const TriggerSourceSchema = z.enum([
  "policy",
  "lexicon",
  "panic_key",
  "self_report_q3",
]);
export type TriggerSource = z.infer<typeof TriggerSourceSchema>;

/** persons.language — Hindi and English only for the MVP. */
export const LanguageSchema = z.enum(["en", "hi"]);
export type Language = z.infer<typeof LanguageSchema>;

/** cases.stage */
export const CaseStageSchema = z.enum([
  "investigation",
  "trial",
  "rehabilitation",
  "compensation",
]);
export type CaseStage = z.infer<typeof CaseStageSchema>;

/** cases.bail_status */
export const BailStatusSchema = z.enum([
  "not_applicable",
  "accused_in_custody",
  "accused_on_bail",
]);
export type BailStatus = z.infer<typeof BailStatusSchema>;

/** consents.capture_method */
export const CaptureMethodSchema = z.enum(["tap", "voice_simulated"]);
export type CaptureMethod = z.infer<typeof CaptureMethodSchema>;

/** alerts.disposition */
export const DispositionSchema = z.enum([
  "contacted",
  "no_action_needed",
  "escalated",
  "pending",
]);
export type Disposition = z.infer<typeof DispositionSchema>;

/** audit_events.role */
export const StaffRoleSchema = z.enum(["counsellor", "operator", "admin"]);
export type StaffRole = z.infer<typeof StaffRoleSchema>;

/** audit_events.action */
export const AuditActionSchema = z.enum([
  "view_queue",
  "view_person",
  "ack_alert",
  "dispose",
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

/* ── jsonb payloads ──────────────────────────────────────────────────────── */

/**
 * checkins.structured — the three self-report questions, 0-4 each
 * (SCORING_AND_POLICY.md section 3). All optional: the column defaults to '{}'
 * and a call can be abandoned part-way through the keypad flow.
 *
 * q3 === 4 ("do not feel safe") is a CRITICAL trigger on its own and does not
 * go through the composite. See SAFETY_SPEC.md section 3.
 */
export const AnswerSchema = z.number().int().min(0).max(4);
export type Answer = z.infer<typeof AnswerSchema>;

export const StructuredAnswersSchema = z.object({
  q1: AnswerSchema.optional(),
  q2: AnswerSchema.optional(),
  q3: AnswerSchema.optional(),
});
export type StructuredAnswers = z.infer<typeof StructuredAnswersSchema>;

/**
 * assessments.components — each 0-100, or null when the signal is missing.
 * A missing signal is NOT a calm signal: never default one of these to 0
 * (SCORING_AND_POLICY.md section 4).
 *
 * s5 is acoustic. It is weighted 0.00 on purpose (section 2) — extracted,
 * shown to the counsellor with a low-confidence caveat, and never scored.
 * That is not dead code. Do not "fix" it.
 */
export const ComponentScoreSchema = z.number().min(0).max(100).nullable();

export const ComponentScoresSchema = z.object({
  s1: ComponentScoreSchema,
  s2: ComponentScoreSchema,
  s3: ComponentScoreSchema,
  s4: ComponentScoreSchema,
  s5: ComponentScoreSchema,
});
export type ComponentScores = z.infer<typeof ComponentScoresSchema>;

/**
 * assessments.contributions — the weighted value of each component, i.e. what
 * the breakdown chart draws. Null wherever the component is null.
 *
 * Never render a composite without these (00_MVP_PLAN.md section 3, rule 6).
 * The breakdown IS the explainability feature.
 */
export const ComponentContributionsSchema = z.object({
  s1: z.number().nullable(),
  s2: z.number().nullable(),
  s3: z.number().nullable(),
  s4: z.number().nullable(),
  s5: z.number().nullable(),
});
export type ComponentContributions = z.infer<
  typeof ComponentContributionsSchema
>;

/** assessments.explanation — human-readable lines from the policy engine. */
export const ExplanationSchema = z.array(z.string());
export type Explanation = z.infer<typeof ExplanationSchema>;

/* ── rows: schema.sql, column for column ─────────────────────────────────── */

/** persons */
export const PersonSchema = z.object({
  id: UuidSchema,
  pseudonym: z.string(), // 'A-4471'. Never a real name.
  language: LanguageSchema,
  is_minor_flag: z.boolean(), // true => human route, NO scoring
  baseline_mean: z.number().nullable(), // EWMA mu, null until 1st check-in
  baseline_var: z.number().nonnegative().nullable(), // EWMA sigma^2
  checkin_count: z.number().int().nonnegative(),
  missed_count: z.number().int().nonnegative(),
  created_at: TimestamptzSchema,
});
export type Person = z.infer<typeof PersonSchema>;

/** cases — the S3 signal source */
export const CaseSchema = z.object({
  id: UuidSchema,
  person_id: UuidSchema,
  atrocity_category: z.string(), // from the case taxonomy
  stage: CaseStageSchema,
  next_hearing_date: DateOnlySchema.nullable(),
  adjournment_count: z.number().int().nonnegative(),
  bail_status: BailStatusSchema,
  relief_due_date: DateOnlySchema.nullable(),
  relief_paid: z.boolean(),
  social_boycott_flag: z.boolean(),
  last_intimidation_report: DateOnlySchema.nullable(),
  opened_at: DateOnlySchema,
});
export type Case = z.infer<typeof CaseSchema>;

/** consents — no scoring may occur without a live row here */
export const ConsentSchema = z.object({
  id: UuidSchema,
  person_id: UuidSchema,
  purpose: z.string(), // default 'distress_monitoring'
  capture_method: CaptureMethodSchema,
  granted_at: TimestamptzSchema,
  withdrawn_at: TimestamptzSchema.nullable(), // non-null => consent withdrawn
});
export type Consent = z.infer<typeof ConsentSchema>;

/** checkins — one row per interaction, any channel */
export const CheckInSchema = z.object({
  id: UuidSchema,
  person_id: UuidSchema,
  consent_id: UuidSchema.nullable(), // column is nullable; the API still requires one
  channel: ChannelSchema,
  transcript: z.string().nullable(),
  structured: StructuredAnswersSchema,
  abandoned: z.boolean(),
  created_at: TimestamptzSchema,
});
export type CheckIn = z.infer<typeof CheckInSchema>;

/** assessments — the scored output */
export const AssessmentSchema = z.object({
  id: UuidSchema,
  checkin_id: UuidSchema,
  person_id: UuidSchema,
  components: ComponentScoresSchema,
  contributions: ComponentContributionsSchema,
  composite: z.number().min(0).max(100),
  z_score: z.number().nullable(), // may be negative; null until a baseline exists
  change_point: z.boolean(),
  tier: TierSchema,
  trigger_source: TriggerSourceSchema,
  explanation: ExplanationSchema,
  policy_version: z.string(),
  model_version: z.string(),
  created_at: TimestamptzSchema,
});
export type Assessment = z.infer<typeof AssessmentSchema>;

/** alerts — ack-required, never silent-fail */
export const AlertSchema = z.object({
  id: UuidSchema,
  assessment_id: UuidSchema,
  person_id: UuidSchema,
  tier: TierSchema,
  sla_minutes: z.number().int().nonnegative(), // RED 30, AMBER 1440, CRITICAL 0
  created_at: TimestamptzSchema,
  acked_at: TimestamptzSchema.nullable(),
  acked_by: z.string().nullable(), // staff handle, not a real name
  disposition: DispositionSchema.nullable(),
});
export type Alert = z.infer<typeof AlertSchema>;

/** audit_events — every staff-side read of person data */
export const AuditEventSchema = z.object({
  id: UuidSchema,
  actor: z.string(),
  role: StaffRoleSchema,
  action: AuditActionSchema,
  subject_id: UuidSchema.nullable(),
  created_at: TimestamptzSchema,
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

/* ── API payloads ────────────────────────────────────────────────────────── */

/**
 * A crisis helpline, rendered by CrisisPanel (TM2_GUIDE.md section 2).
 * The values come from lib/safety/replies.ts, never from the LLM.
 */
export const CrisisResourceSchema = z.object({
  label: z.string(), // 'NHAA', 'Tele-MANAS'
  phone: z.string(), // '14566', '14416' — short codes, kept as strings
  note: z.string().optional(),
});
export type CrisisResource = z.infer<typeof CrisisResourceSchema>;

/** POST /api/checkin — request */
export const CheckInRequestSchema = z.object({
  personId: UuidSchema,
  channel: ChannelSchema,
  transcript: z.string().optional(),
  structured: StructuredAnswersSchema.optional(),
  consentId: UuidSchema, // required: no consent row => 403, no assessment written
});
export type CheckInRequest = z.infer<typeof CheckInRequestSchema>;

/**
 * POST /api/checkin — response.
 * When tier is 'CRITICAL', resources is present and CrisisPanel renders it in
 * the same paint, with no further fetch (SAFETY_SPEC.md section 3).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CONTRACT CHANGE, Day 4. `tier` and `assessmentId` became OPTIONAL.
 * Authorised by TM1; the rest of this file is unchanged and still frozen.
 *
 * They were required, and the minor route (CLAUDE.md rule 10, SAFETY_SPEC.md
 * test S10) has neither: it routes to a human, writes no assessment, and
 * assigns no tier. Meeting the old shape meant answering with a nil UUID and
 * a GREEN — a value that reads as "low risk" for a person the system
 * deliberately refused to score. Sending a made-up tier is worse than sending
 * none, so the type now says what is true: both fields are ABSENT when nothing
 * was scored, and present on every path that scored something.
 *
 * CONSUMERS: `tier === undefined` means "not scored, routed to a human", never
 * "safe". Do not default it to GREEN when rendering, and do not treat a missing
 * `assessmentId` as a lookup failure — there is no row to look up.
 * ─────────────────────────────────────────────────────────────────────────
 */
export const CheckInResponseSchema = z.object({
  reply: z.string(),
  /** Absent when nothing was scored. Absent is not GREEN. */
  tier: TierSchema.optional(),
  resources: z.array(CrisisResourceSchema).optional(),
  /** Absent when no assessment row was written. */
  assessmentId: UuidSchema.optional(),
  nextQuestionId: z.string().optional(),
});
export type CheckInResponse = z.infer<typeof CheckInResponseSchema>;

/** GET /api/staff/queue — one row of the counsellor queue */
export const QueueItemSchema = z.object({
  personId: UuidSchema,
  pseudonym: z.string(),
  tier: TierSchema,
  composite: z.number().min(0).max(100),
  changePoint: z.boolean(),
  createdAt: TimestamptzSchema,
  acked: z.boolean(),
  slaMinutes: z.number().int().nonnegative(),
});
export type QueueItem = z.infer<typeof QueueItemSchema>;

/** GET /api/staff/person/[id] — the detail view behind the trend chart */
export const PersonDetailSchema = z.object({
  person: PersonSchema,
  case: CaseSchema,
  assessments: z.array(AssessmentSchema), // oldest first: the trend line
  alerts: z.array(AlertSchema),
});
export type PersonDetail = z.infer<typeof PersonDetailSchema>;
