/**
 * lib/db/index.ts — the database port.
 *
 * Owner: TM1. Implements the storage half of docs/TM1_GUIDE.md section 7
 * (Prompt 9): the consent gate, the checkin/assessment/alert writes, the
 * counsellor queue, and the audit trail.
 *
 * ## Why there is an interface here at all
 *
 * Every route handler talks to this interface, never to `@supabase/supabase-js`
 * directly. Two reasons, both concrete:
 *
 * 1. `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS (supabase/schema.sql). Keeping
 *    the client behind one module means there is exactly one file to grep when
 *    someone asks whether the key can reach a client component, and the answer
 *    stays "no" without re-reading every route.
 * 2. The crisis-path latency assertion (CHECKS_TM1.md T1-C11) has to run the
 *    real route handler with the model hung and the database instant. Without
 *    a seam, that test would need a live Supabase project, which means it would
 *    not run, which means the 100 ms budget would not be measured.
 *
 * It is a port, not an ORM (CLAUDE.md, scope discipline). The methods are the
 * eleven queries this MVP makes, spelled out. No query builder, no migrations,
 * no repository pattern.
 *
 * ## Row shapes
 *
 * Everything crossing this boundary is a row type from types/contract.ts,
 * validated on the way out of the adapter. Nothing defines a parallel local
 * interface for the same object (CLAUDE.md, conventions).
 */

import { createSupabaseDb } from "./supabase";
import type {
  Alert,
  Assessment,
  AuditAction,
  Case,
  Channel,
  CheckIn,
  ComponentContributions,
  ComponentScores,
  Consent,
  Disposition,
  Explanation,
  Person,
  PersonDetail,
  StaffRole,
  StructuredAnswers,
  Tier,
  TriggerSource,
  Uuid,
} from "@/types/contract";

/* ── write shapes ────────────────────────────────────────────────────────── */

/** `checkins`, minus the columns Postgres fills in (id, created_at). */
export interface CheckInInsert {
  person_id: Uuid;
  consent_id: Uuid;
  channel: Channel;
  transcript: string | null;
  structured: StructuredAnswers;
  abandoned: boolean;
}

/**
 * `assessments`, minus id and created_at.
 *
 * `policy_version` and `model_version` are REQUIRED, not optional, on every
 * insert path including the lexicon short-circuit (CHECKS_TM1.md T1-C8). A row
 * that cannot say which policy scored it cannot be interpreted six months
 * later, so the type refuses to let a caller forget.
 */
export interface AssessmentInsert {
  checkin_id: Uuid;
  person_id: Uuid;
  components: ComponentScores;
  contributions: ComponentContributions;
  composite: number;
  z_score: number | null;
  change_point: boolean;
  tier: Tier;
  trigger_source: TriggerSource;
  explanation: Explanation;
  policy_version: string;
  model_version: string;
}

/** `alerts`, minus id, created_at, and the three ack columns. */
export interface AlertInsert {
  assessment_id: Uuid;
  person_id: Uuid;
  tier: Tier;
  sla_minutes: number;
}

/**
 * The EWMA state carried on `persons` between check-ins
 * (SCORING_AND_POLICY.md section 7).
 *
 * `checkin_count` is the number of check-ins folded into that baseline, which
 * is what the change-point rule counts as history. It moves in lockstep with
 * mean and variance and is therefore written in the same statement — a
 * check-in that did not update the baseline must not increment it, or the
 * min-history test starts counting check-ins that contributed nothing.
 */
export interface BaselineUpdate {
  baseline_mean: number;
  baseline_var: number;
  checkin_count: number;
}

/** The human closing an alert. `acked_by` is a staff handle, never a real name. */
export interface AckInput {
  acked_by: string;
  disposition: Disposition;
}

/** One `audit_events` row. Written on every staff-side read of person data. */
export interface AuditInsert {
  actor: string;
  role: StaffRole;
  action: AuditAction;
  subject_id: Uuid | null;
}

/**
 * One line of the counsellor queue, before the route sorts it and applies the
 * policy's SLA. The Db returns the rows; ordering and tier policy are the
 * route's job and stay visible there.
 */
export interface QueueRow {
  person: Person;
  /** That person's most recent assessment. There is always at least one. */
  assessment: Assessment;
  /** The alert raised by that assessment, or null when the tier raised none. */
  alert: Alert | null;
}

/* ── the port ────────────────────────────────────────────────────────────── */

export interface Db {
  /* check-in path */

  loadPerson(personId: Uuid): Promise<Person | null>;
  /**
   * The consent gate (SAFETY_SPEC.md section 8, test S6). Returns a row only
   * when it belongs to this person, matches the id the caller presented, and
   * has NOT been withdrawn. A withdrawn row is not a live row.
   */
  loadLiveConsent(consentId: Uuid, personId: Uuid): Promise<Consent | null>;
  /** The S3 signal source. Most recently opened case when a person has several. */
  loadCase(personId: Uuid): Promise<Case | null>;

  insertCheckIn(row: CheckInInsert): Promise<CheckIn>;
  insertAssessment(row: AssessmentInsert): Promise<Assessment>;
  insertAlert(row: AlertInsert): Promise<Alert>;
  updateBaseline(personId: Uuid, update: BaselineUpdate): Promise<void>;

  /* staff path */

  /** Latest assessment per person, with its alert. Unsorted. */
  loadQueueRows(): Promise<QueueRow[]>;
  /** Assessments oldest first — the trend line. Null when the person does not exist. */
  loadPersonDetail(personId: Uuid): Promise<PersonDetail | null>;
  loadAlert(alertId: Uuid): Promise<Alert | null>;
  ackAlert(alertId: Uuid, input: AckInput): Promise<Alert>;

  writeAudit(event: AuditInsert): Promise<void>;
}

/* ── resolution ──────────────────────────────────────────────────────────── */

let real: Db | null = null;
let override: Db | null = null;

/**
 * The Db for this process.
 *
 * Server-side only. It reads `SUPABASE_SERVICE_ROLE_KEY`, so calling it from a
 * client component is a leak of the key that bypasses RLS — never import this
 * from a file carrying 'use client' (CHECKS_TM3.md T3-A4).
 *
 * The adapter is memoised, and it does not touch the environment until the
 * first query runs — see `client()` in ./supabase.ts. Importing a route in a
 * test that never reaches the database therefore needs no credentials.
 */
export function getDb(): Db {
  if (override !== null) return override;
  if (real === null) real = createSupabaseDb();
  return real;
}

/**
 * TEST SEAM. Substitute an in-memory Db, or pass null to restore the real one.
 *
 * The name is deliberately ugly. This exists so `npm run test -- latency` can
 * drive the real POST handler with the model hung and the database instant
 * (CHECKS_TM1.md T1-C11); it is not a configuration hook, and nothing outside
 * a *.test.ts file may call it. If you are reaching for this in application
 * code, the thing you want is `getDb()`.
 */
export function __setDbForTests(db: Db | null): void {
  override = db;
}
