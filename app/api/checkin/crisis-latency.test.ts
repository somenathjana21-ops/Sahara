/**
 * app/api/checkin/crisis-latency.test.ts — steps 1-4 of the pipeline, budgeted.
 *
 * Owner: TM1. Guards docs/TM1_GUIDE.md section 7, Prompt 9:
 *
 *   "Latency budget: steps 1-4 must complete in under 100ms. Instrument and
 *    assert this in a test — a person in crisis cannot wait on a model."
 *
 * and CHECKS_TM1.md T1-C11, which runs `npm run test -- latency` and expects
 * the budget met "with the LLM mocked to hang". The filename has to contain
 * "latency" because that harness filters by PATH, not by test name.
 *
 * ## How the model is hung
 *
 * `globalThis.fetch` is replaced with a function that returns a promise which
 * never settles. Every provider in lib/llm/ reaches the network through
 * `postJson` in lib/llm/http.ts, so this hangs all four without the test
 * knowing which one is configured — and it means the assertions below are not
 * "the code looks like it returns early", they are "the model is unreachable
 * and a person in crisis was answered anyway".
 *
 * The counter on that stub is the other half of the proof: `fetchCalls`
 * staying at 0 is what makes CHECKS_TM1.md T1-B6 (critical short-circuits the
 * model) an executable check rather than a code reading.
 *
 * ## Why the database is faked
 *
 * Steps 2 and 4 both touch the database — the consent gate reads, the crisis
 * branch writes three rows — so a budget measured without one would not be
 * measuring the handler. The fake makes the storage instant so what is left on
 * the clock is this repo's own work: validation, the consent gate, the
 * lexicon walk, and building the response.
 *
 * That is also the honest limitation of the number. It does not include
 * Supabase's round trip or a cold serverless start. It measures the part this
 * code controls, which is the part a regression would land in.
 */

import { strict as assert } from "node:assert";
import test, { afterEach, beforeEach } from "node:test";

import {
  __setDbForTests,
  type AckInput,
  type AlertInsert,
  type AssessmentInsert,
  type CheckInInsert,
  type Db,
} from "@/lib/db";
import type {
  Alert,
  Assessment,
  Case,
  CheckIn,
  Consent,
  Person,
  PersonDetail,
  Uuid,
} from "@/types/contract";

import { POST } from "./route";

/** docs/TM1_GUIDE.md section 7, Prompt 9. */
const BUDGET_MS = 100;

/* ── synthetic rows. Pseudonyms only, no PII (CLAUDE.md rule 6). ─────────── */

const PERSON_ID = "aaaaaaaa-0000-0000-0000-000000000001";
const CONSENT_ID = "aaaaaaaa-0000-0000-0000-000000000002";
const CASE_ID = "aaaaaaaa-0000-0000-0000-000000000003";

const NOW = "2026-09-01T09:00:00+05:30";

function isoDate(offsetDays: number): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: PERSON_ID,
    pseudonym: "A-9001",
    language: "en",
    is_minor_flag: false,
    baseline_mean: null,
    baseline_var: null,
    checkin_count: 0,
    missed_count: 0,
    created_at: NOW,
    ...overrides,
  };
}

const consent: Consent = {
  id: CONSENT_ID,
  person_id: PERSON_ID,
  purpose: "distress_monitoring",
  capture_method: "tap",
  granted_at: NOW,
  withdrawn_at: null,
};

/** Every S3 row deliberately switched off, so the arithmetic below is short. */
const quietCase: Case = {
  id: CASE_ID,
  person_id: PERSON_ID,
  atrocity_category: "land_dispossession",
  stage: "investigation",
  next_hearing_date: null,
  adjournment_count: 0,
  bail_status: "not_applicable",
  relief_due_date: null,
  relief_paid: true,
  social_boycott_flag: false,
  last_intimidation_report: null,
  opened_at: isoDate(-10),
};

/* ── the fake Db ─────────────────────────────────────────────────────────── */

interface Writes {
  checkins: CheckInInsert[];
  assessments: AssessmentInsert[];
  alerts: AlertInsert[];
  baselines: unknown[];
}

function fakeDb(options: {
  person: Person | null;
  consent: Consent | null;
  caseRow?: Case | null;
}): { db: Db; writes: Writes } {
  const writes: Writes = { checkins: [], assessments: [], alerts: [], baselines: [] };
  let n = 0;
  const nextId = (): Uuid => `bbbbbbbb-0000-0000-0000-${String(++n).padStart(12, "0")}`;

  const unused = (what: string) => async (): Promise<never> => {
    throw new Error(`fakeDb.${what} should not be reached by POST /api/checkin`);
  };

  const db: Db = {
    async loadPerson() {
      return options.person;
    },
    async loadLiveConsent() {
      return options.consent;
    },
    async loadCase() {
      return options.caseRow ?? null;
    },
    async insertCheckIn(row: CheckInInsert): Promise<CheckIn> {
      writes.checkins.push(row);
      return { id: nextId(), created_at: NOW, ...row };
    },
    async insertAssessment(row: AssessmentInsert): Promise<Assessment> {
      writes.assessments.push(row);
      return { id: nextId(), created_at: NOW, ...row };
    },
    async insertAlert(row: AlertInsert): Promise<Alert> {
      writes.alerts.push(row);
      return {
        id: nextId(),
        created_at: NOW,
        acked_at: null,
        acked_by: null,
        disposition: null,
        ...row,
      };
    },
    async updateBaseline(_personId, update) {
      writes.baselines.push(update);
    },
    loadQueueRows: unused("loadQueueRows") as Db["loadQueueRows"],
    loadPersonDetail: unused("loadPersonDetail") as unknown as (
      id: Uuid,
    ) => Promise<PersonDetail | null>,
    loadAlert: unused("loadAlert") as unknown as (id: Uuid) => Promise<Alert | null>,
    ackAlert: unused("ackAlert") as unknown as (id: Uuid, i: AckInput) => Promise<Alert>,
    writeAudit: unused("writeAudit") as unknown as Db["writeAudit"],
  };

  return { db, writes };
}

/* ── the hung model ──────────────────────────────────────────────────────── */

const realFetch = globalThis.fetch;
let fetchCalls = 0;

/** Accepts the call and never answers. The worst case a provider can present. */
function hangFetch(): void {
  fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    return new Promise<Response>(() => {});
  }) as typeof fetch;
}

/** Fails immediately, so the degradation path can be exercised without waiting. */
function refuseFetch(): void {
  fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.reject(new Error("ECONNREFUSED (test)"));
  }) as typeof fetch;
}

let savedProvider: string | undefined;

beforeEach(() => {
  /*
   * A provider must be selected, or the route degrades on UnknownProviderError
   * before it ever reaches the transport — which would make `fetchCalls` prove
   * nothing. Which one is irrelevant: the stub below replaces the transport
   * they all share. The local one is named because it needs no API key, and
   * because writing a hosted provider's slug into a test file would trip the
   * grep behind CHECKS_TM1.md T1-D2 for a reason that is not a real one.
   *
   * Set, not defaulted: a developer with LLM_PROVIDER exported in their shell
   * must get the same result as CI, and a hosted provider inherited from the
   * environment would fail on its missing key before reaching the transport.
   */
  savedProvider = process.env.LLM_PROVIDER;
  process.env.LLM_PROVIDER = "ollama";
});

afterEach(() => {
  globalThis.fetch = realFetch;
  __setDbForTests(null);
  if (savedProvider === undefined) delete process.env.LLM_PROVIDER;
  else process.env.LLM_PROVIDER = savedProvider;
});

function crisisRequest(): Request {
  return new Request("http://localhost/api/checkin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      personId: PERSON_ID,
      consentId: CONSENT_ID,
      channel: "chat",
      transcript: "there is no way out of this, I want to kill myself",
      structured: { q1: 3, q2: 3 },
    }),
  });
}

/* ── the assertions ──────────────────────────────────────────────────────── */

test("a lexicon hit is answered inside the 100 ms budget with the model hung", async () => {
  const { db } = fakeDb({ person: person(), consent });
  __setDbForTests(db);
  hangFetch();

  // One untimed pass, exactly as lib/safety/latency.test.ts does: the budget
  // is about steady-state request latency, not about first-call JIT warm-up.
  await POST(crisisRequest());

  const samples: number[] = [];
  for (let i = 0; i < 3; i++) {
    const started = performance.now();
    const response = await POST(crisisRequest());
    samples.push(performance.now() - started);
    assert.equal(response.status, 200);
  }

  const worst = Math.max(...samples);
  assert.ok(
    worst < BUDGET_MS,
    `steps 1-4 took up to ${worst.toFixed(1)} ms, budget is ${BUDGET_MS} ms ` +
      "(TM1_GUIDE.md section 7, Prompt 9). A person in crisis cannot wait on a model.",
  );
});

test("the crisis response carries the tier, the fixed reply and the resources", async () => {
  const { db, writes } = fakeDb({ person: person(), consent });
  __setDbForTests(db);
  hangFetch();

  const response = await POST(crisisRequest());
  const body = (await response.json()) as {
    tier: string;
    reply: string;
    resources?: { phone: string }[];
    assessmentId: string;
  };

  assert.equal(response.status, 200);
  assert.equal(body.tier, "CRITICAL");
  // SAFETY_SPEC.md section 3: resources render in the SAME response, with no
  // second fetch for a person who is in crisis right now.
  assert.ok(body.resources && body.resources.length > 0, "resources must be present");
  assert.deepEqual(
    body.resources?.map((r) => r.phone),
    ["14566", "14416", "1800-89-14416"],
    "the numbers come from lib/safety/replies.ts and nowhere else",
  );
  // The reply is the fixed crisis string, not anything generated (rule 3).
  assert.match(body.reply, /support worker/);

  // Step 4 writes all three rows.
  assert.equal(writes.checkins.length, 1);
  assert.equal(writes.assessments.length, 1);
  assert.equal(writes.alerts.length, 1);
  assert.equal(writes.assessments[0].tier, "CRITICAL");
  assert.equal(writes.assessments[0].trigger_source, "lexicon");
  assert.equal(writes.alerts[0].sla_minutes, 0);
  // Versioned on every insert path, the short-circuit included (T1-C8).
  assert.ok(writes.assessments[0].policy_version.length > 0);
  assert.ok(writes.assessments[0].model_version.length > 0);
  // Unscored, and structurally un-renderable as a score: null contributions
  // mean there is no breakdown, and CLAUDE.md rule 8 forbids drawing a
  // composite without one.
  assert.deepEqual(writes.assessments[0].components, {
    s1: null,
    s2: null,
    s3: null,
    s4: null,
    s5: null,
  });
  assert.equal(writes.baselines.length, 0, "a crisis short-circuit scores nothing");
});

test("the model is never contacted on the crisis path (T1-B6)", async () => {
  const { db } = fakeDb({ person: person(), consent });
  __setDbForTests(db);
  hangFetch();

  await POST(crisisRequest());

  assert.equal(
    fetchCalls,
    0,
    "Pass 1 fired, so the LLM must not have been called at all (SAFETY_SPEC.md section 2)",
  );
});

test("an unset PROJECT_TZ cannot 500 a person in crisis (T1-B5a)", async () => {
  const { db } = fakeDb({ person: person(), consent });
  __setDbForTests(db);
  hangFetch();

  /*
   * `loadPolicy()` throws without PROJECT_TZ set (assertTimezonePinned in
   * lib/policy/engine.ts). This is the executable form of T1-B5a: with the
   * variable removed, the crisis path must still answer 200 with resources,
   * which is only possible if `checkInput` runs strictly before `loadPolicy`
   * and the lexicon branch returns before reaching it.
   */
  const saved = process.env.PROJECT_TZ;
  delete process.env.PROJECT_TZ;
  try {
    const response = await POST(crisisRequest());
    const body = (await response.json()) as { tier: string; resources?: unknown[] };

    assert.equal(response.status, 200, "a misconfigured server must not swallow a crisis");
    assert.equal(body.tier, "CRITICAL");
    assert.ok(body.resources && body.resources.length > 0);
  } finally {
    if (saved === undefined) delete process.env.PROJECT_TZ;
    else process.env.PROJECT_TZ = saved;
  }
});

test("no live consent means 403 and nothing written, inside the same budget (S6)", async () => {
  const { db, writes } = fakeDb({ person: person(), consent: null });
  __setDbForTests(db);
  hangFetch();

  await POST(crisisRequest());

  const started = performance.now();
  const response = await POST(crisisRequest());
  const elapsed = performance.now() - started;

  assert.equal(response.status, 403);
  assert.equal(writes.checkins.length, 0, "no checkins row may be written");
  assert.equal(writes.assessments.length, 0, "no assessments row may be written");
  assert.ok(
    elapsed < BUDGET_MS,
    `the consent refusal took ${elapsed.toFixed(1)} ms, budget is ${BUDGET_MS} ms`,
  );
});

test("a minor is routed to a human with a checkin and zero assessments (S10)", async () => {
  const { db, writes } = fakeDb({ person: person({ is_minor_flag: true }), consent });
  __setDbForTests(db);
  hangFetch();

  const response = await POST(crisisRequest());
  const body = (await response.json()) as {
    reply: string;
    tier?: string;
    assessmentId?: string;
  };

  assert.equal(response.status, 200);
  assert.match(body.reply, /support worker will take this forward/);
  // Both omitted, not invented. Nothing was scored, so there is no tier and no
  // assessment to point at (types/contract.ts, the Day 4 contract change).
  assert.equal(body.tier, undefined, "a person who was not scored has no tier");
  assert.equal(body.assessmentId, undefined, "there is no assessment row to name");
  assert.equal(writes.checkins.length, 1, "the contact is still recorded");
  assert.equal(writes.assessments.length, 0, "a minor is never scored (CLAUDE.md rule 10)");
  assert.equal(fetchCalls, 0, "and the model is never consulted");
});

test("an unreachable provider degrades to S2 null instead of failing the check-in (S5)", async () => {
  const { db, writes } = fakeDb({ person: person(), consent, caseRow: quietCase });
  __setDbForTests(db);
  // Rejecting rather than hanging: this path is meant to reach the provider,
  // and postJson retries twice before giving up.
  refuseFetch();

  const response = await POST(
    new Request("http://localhost/api/checkin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        personId: PERSON_ID,
        consentId: CONSENT_ID,
        channel: "chat",
        transcript: "the hearing keeps getting pushed back and I am tired of it",
        structured: { q1: 1, q2: 1, q3: 1 },
      }),
    }),
  );
  const body = (await response.json()) as { tier: string; reply: string };

  assert.equal(response.status, 200, "a provider outage is a degradation, never a 500");
  assert.ok(fetchCalls > 0, "this path really did try to reach the model");

  const written = writes.assessments[0];
  assert.equal(written.components.s2, null, "S2 is null, never 0 — a missing signal is not calm");
  assert.equal(written.contributions.s2, null);
  assert.match(written.model_version, /^none:unavailable\+prompt-/);
  // Renormalised over S1 (0.35), S3 (0.25) and S4 (0.15): S1 = 25 carries
  // 0.35/0.75 of the weight and every other present component is 0, so the
  // composite is 25 x 0.4667 = 11.67. Substituting 0 for S2 would have given
  // 8.75 — lower, from an outage (SCORING_AND_POLICY.md section 4).
  assert.ok(
    Math.abs(written.composite - 11.67) < 0.05,
    `expected the renormalised composite 11.67, got ${written.composite}`,
  );
  assert.equal(written.tier, "GREEN");
  assert.equal(writes.alerts.length, 0, "GREEN raises no alert");
  assert.equal(writes.baselines.length, 1, "the person's baseline still advances");
});
