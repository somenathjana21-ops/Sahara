/**
 * lib/db/supabase.ts — the only file that talks to Supabase.
 *
 * Owner: TM1. Implements the `Db` port in ./index.ts against the schema in
 * supabase/schema.sql.
 *
 * ## Server-only, and why that is not just a convention
 *
 * `SUPABASE_SERVICE_ROLE_KEY` bypasses row level security. Every table in
 * schema.sql has RLS enabled with no policies, so the anon key can read
 * nothing and this key can read everything — which is the design: the browser
 * never talks to Supabase, and all access goes through route handlers. Never
 * import this module from a file carrying the client directive, and never
 * prefix either variable with NEXT_PUBLIC_ (CHECKS_TM1.md T1-A1/T1-A2,
 * CHECKS_TM3.md T3-A4).
 *
 * ## Everything is validated on the way out
 *
 * PostgREST returns JSON, not typed rows: a `numeric` column can arrive as a
 * string depending on precision, and a column added by someone else's
 * migration arrives as an extra key. So every row is coerced and then parsed
 * against types/contract.ts before it leaves this file. A row that does not
 * match the contract stops here with a loud error rather than travelling into
 * the scorer as a string that silently concatenates instead of adding.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  AlertSchema,
  AssessmentSchema,
  CaseSchema,
  CheckInSchema,
  ConsentSchema,
  PersonDetailSchema,
  PersonSchema,
  type Alert,
  type Assessment,
  type Case,
  type CheckIn,
  type Consent,
  type Person,
  type PersonDetail,
  type Uuid,
} from "@/types/contract";
import type {
  AckInput,
  AlertInsert,
  AssessmentInsert,
  AuditInsert,
  BaselineUpdate,
  CheckInInsert,
  Db,
  QueueRow,
} from "./index";

/* ── connection ──────────────────────────────────────────────────────────── */

let cached: SupabaseClient | null = null;

/**
 * Read the environment on first use, not at module load.
 *
 * A route that imports the Db but returns before querying it — the consent
 * refusal, the crisis short-circuit under test — must not require Supabase
 * credentials to exist. Failing at the first query rather than at import time
 * also puts the error where it can be reported as a 5xx with a message,
 * instead of as a module that would not load.
 */
function client(): SupabaseClient {
  if (cached !== null) return cached;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set (server-side only). " +
        "See README.md, Environment variables.",
    );
  }

  cached = createClient(url, key, {
    // No browser, no session, no token refresh timer: this client lives inside
    // a request handler and dies with it.
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

type Row = Record<string, unknown>;

/** Unwrap a PostgREST result, or throw with the operation named. */
function must<T>(
  what: string,
  res: { data: T | null; error: { message: string } | null },
): T {
  if (res.error !== null) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null) throw new Error(`${what}: returned no row`);
  return res.data;
}

/**
 * `numeric` is the only column type here that PostgREST may hand back as a
 * string, and it is the type of every number the scorer reads. Coercing at the
 * boundary is cheaper than a zod union on eight fields, and it keeps the
 * contract schemas describing the domain rather than the driver.
 */
function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`expected a number, got ${JSON.stringify(value)}`);
  }
  return n;
}

function toPerson(row: Row): Person {
  return PersonSchema.parse({
    ...row,
    baseline_mean: num(row.baseline_mean),
    baseline_var: num(row.baseline_var),
  });
}

function toAssessment(row: Row): Assessment {
  return AssessmentSchema.parse({
    ...row,
    composite: num(row.composite),
    z_score: num(row.z_score),
  });
}

/**
 * Someone else acked first. Carries no row: the caller re-reads and decides
 * what to tell the counsellor, rather than this layer deciding it.
 */
export class AlertAlreadyAckedError extends Error {
  readonly alertId: string;

  constructor(alertId: string) {
    super(`alert ${alertId} has already been acknowledged`);
    this.name = "AlertAlreadyAckedError";
    this.alertId = alertId;
  }
}

/* ── the adapter ─────────────────────────────────────────────────────────── */

/** How many recent assessments the queue reads before reducing to one per person. */
const QUEUE_SCAN_LIMIT = 500;

export function createSupabaseDb(): Db {
  return {
    async loadPerson(personId: Uuid): Promise<Person | null> {
      const { data, error } = await client()
        .from("persons")
        .select("*")
        .eq("id", personId)
        .maybeSingle();
      if (error) throw new Error(`loadPerson: ${error.message}`);
      return data === null ? null : toPerson(data as Row);
    },

    /**
     * The consent gate. All three conditions sit in the WHERE clause on
     * purpose: a consent row belonging to a different person, and one that has
     * been withdrawn, must be indistinguishable from no row at all — the
     * caller's only correct answer to any of them is the same 403
     * (SAFETY_SPEC.md section 8, test S6).
     */
    async loadLiveConsent(consentId: Uuid, personId: Uuid): Promise<Consent | null> {
      const { data, error } = await client()
        .from("consents")
        .select("*")
        .eq("id", consentId)
        .eq("person_id", personId)
        .is("withdrawn_at", null)
        .maybeSingle();
      if (error) throw new Error(`loadLiveConsent: ${error.message}`);
      return data === null ? null : ConsentSchema.parse(data);
    },

    async loadCase(personId: Uuid): Promise<Case | null> {
      const { data, error } = await client()
        .from("cases")
        .select("*")
        .eq("person_id", personId)
        .order("opened_at", { ascending: false })
        .limit(1);
      if (error) throw new Error(`loadCase: ${error.message}`);
      return !data || data.length === 0 ? null : CaseSchema.parse(data[0]);
    },

    async insertCheckIn(row: CheckInInsert): Promise<CheckIn> {
      const res = await client().from("checkins").insert(row).select().single();
      return CheckInSchema.parse(must("insertCheckIn", res));
    },

    async insertAssessment(row: AssessmentInsert): Promise<Assessment> {
      const res = await client().from("assessments").insert(row).select().single();
      return toAssessment(must("insertAssessment", res) as Row);
    },

    async insertAlert(row: AlertInsert): Promise<Alert> {
      const res = await client().from("alerts").insert(row).select().single();
      return AlertSchema.parse(must("insertAlert", res));
    },

    async updateBaseline(personId: Uuid, update: BaselineUpdate): Promise<void> {
      const { error } = await client()
        .from("persons")
        .update(update)
        .eq("id", personId);
      if (error) throw new Error(`updateBaseline: ${error.message}`);
    },

    /**
     * The queue, in three round trips rather than a view.
     *
     * PostgREST has no window functions, so "latest assessment per person" is
     * done by reading the most recent assessments and keeping the first of
     * each person_id — the ordering makes that the newest one. At MVP scale
     * (tens of personas) the scan limit is never reached; it is here so a
     * database that has been hammered by an eval run cannot turn one queue
     * view into an unbounded read.
     */
    async loadQueueRows(): Promise<QueueRow[]> {
      const assessments = await client()
        .from("assessments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(QUEUE_SCAN_LIMIT);
      if (assessments.error) {
        throw new Error(`loadQueueRows assessments: ${assessments.error.message}`);
      }

      const latest = new Map<string, Assessment>();
      for (const row of assessments.data ?? []) {
        const parsed = toAssessment(row as Row);
        if (!latest.has(parsed.person_id)) latest.set(parsed.person_id, parsed);
      }
      if (latest.size === 0) return [];

      const personIds = [...latest.keys()];
      const assessmentIds = [...latest.values()].map((a) => a.id);

      const [persons, alerts] = await Promise.all([
        client().from("persons").select("*").in("id", personIds),
        client().from("alerts").select("*").in("assessment_id", assessmentIds),
      ]);
      if (persons.error) throw new Error(`loadQueueRows persons: ${persons.error.message}`);
      if (alerts.error) throw new Error(`loadQueueRows alerts: ${alerts.error.message}`);

      const alertByAssessment = new Map<string, Alert>();
      for (const row of alerts.data ?? []) {
        const parsed = AlertSchema.parse(row);
        alertByAssessment.set(parsed.assessment_id, parsed);
      }

      const rows: QueueRow[] = [];
      for (const row of persons.data ?? []) {
        const person = toPerson(row as Row);
        const assessment = latest.get(person.id);
        if (assessment === undefined) continue;
        rows.push({
          person,
          assessment,
          alert: alertByAssessment.get(assessment.id) ?? null,
        });
      }
      return rows;
    },

    /**
     * Assessments come back OLDEST FIRST because they are a trend line, and
     * each one carries the components that were true when it was written.
     * This method reads them; it never recomputes S3 from today's `cases` row,
     * which would redraw history against a case file that has since moved
     * (SCORING_AND_POLICY.md section 5, CHECKS_TM1.md T1-C12).
     */
    async loadPersonDetail(personId: Uuid): Promise<PersonDetail | null> {
      const personRow = await client()
        .from("persons")
        .select("*")
        .eq("id", personId)
        .maybeSingle();
      if (personRow.error) {
        throw new Error(`loadPersonDetail person: ${personRow.error.message}`);
      }
      if (personRow.data === null) return null;

      const [caseRows, assessmentRows, alertRows] = await Promise.all([
        client()
          .from("cases")
          .select("*")
          .eq("person_id", personId)
          .order("opened_at", { ascending: false })
          .limit(1),
        client()
          .from("assessments")
          .select("*")
          .eq("person_id", personId)
          .order("created_at", { ascending: true }),
        client()
          .from("alerts")
          .select("*")
          .eq("person_id", personId)
          .order("created_at", { ascending: false }),
      ]);
      if (caseRows.error) throw new Error(`loadPersonDetail case: ${caseRows.error.message}`);
      if (assessmentRows.error) {
        throw new Error(`loadPersonDetail assessments: ${assessmentRows.error.message}`);
      }
      if (alertRows.error) throw new Error(`loadPersonDetail alerts: ${alertRows.error.message}`);

      const caseData = caseRows.data ?? [];
      if (caseData.length === 0) {
        // PersonDetail requires a case: the S3 reasons this view exists to
        // explain come from it. A person with no case row is a seeding bug,
        // and reporting it as "not found" would send whoever hit it looking in
        // the wrong table.
        throw new Error(`loadPersonDetail: person ${personId} has no case row`);
      }

      return PersonDetailSchema.parse({
        person: toPerson(personRow.data as Row),
        case: caseData[0],
        assessments: (assessmentRows.data ?? []).map((r) => toAssessment(r as Row)),
        alerts: (alertRows.data ?? []).map((r) => AlertSchema.parse(r)),
      });
    },

    async loadAlert(alertId: Uuid): Promise<Alert | null> {
      const { data, error } = await client()
        .from("alerts")
        .select("*")
        .eq("id", alertId)
        .maybeSingle();
      if (error) throw new Error(`loadAlert: ${error.message}`);
      return data === null ? null : AlertSchema.parse(data);
    },

    /**
     * `acked_at` is stamped here rather than by the caller, and the update
     * carries `.is("acked_at", null)` so it loses safely when two counsellors
     * ack the same alert at once: the second one updates zero rows and is told
     * so, instead of quietly overwriting the first one's disposition on a
     * CRITICAL.
     */
    async ackAlert(alertId: Uuid, input: AckInput): Promise<Alert> {
      const { data, error } = await client()
        .from("alerts")
        .update({
          acked_at: new Date().toISOString(),
          acked_by: input.acked_by,
          disposition: input.disposition,
        })
        .eq("id", alertId)
        .is("acked_at", null)
        .select();
      if (error) throw new Error(`ackAlert: ${error.message}`);
      if (!data || data.length === 0) throw new AlertAlreadyAckedError(alertId);
      return AlertSchema.parse(data[0]);
    },

    async writeAudit(event: AuditInsert): Promise<void> {
      const { error } = await client().from("audit_events").insert(event);
      if (error) throw new Error(`writeAudit: ${error.message}`);
    },
  };
}
