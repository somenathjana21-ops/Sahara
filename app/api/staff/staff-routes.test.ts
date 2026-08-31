/**
 * app/api/staff/staff-routes.test.ts — the gate, the ordering, and the one
 * rule the ack endpoint exists for.
 *
 * Owner: TM1. Covers docs/TM1_GUIDE.md section 7 (Prompt 9), plus:
 *   CHECKS_TM3.md T3-A5 — the passcode is compared server-side
 *   CHECKS_TM3.md T3-A6 — the session cookie is httpOnly and sameSite=lax
 *   CHECKS_TM3.md T3-A7 — the API is gated separately from the page
 *   CHECKS_TM3.md T3-C6 — every staff-side read writes an audit_events row
 *   CLAUDE.md rule 4    — only a human closes a CRITICAL
 *
 * The Db is faked (see lib/db/index.ts, `__setDbForTests`) so these run with
 * no Supabase project. What is NOT faked is the handlers: the sort, the SLA
 * fallback, the passcode comparison and the disposition rule are the real ones.
 */

import { strict as assert } from "node:assert";
import test, { afterEach, beforeEach } from "node:test";

import { __setDbForTests, type AckInput, type AuditInsert, type Db, type QueueRow } from "@/lib/db";
import { AlertAlreadyAckedError } from "@/lib/db/supabase";
import type { Alert, Assessment, Person, Tier, Uuid } from "@/types/contract";

import { POST as ack } from "./alert/[id]/ack/route";
import { POST as auth } from "./auth/route";
import { GET as queue } from "./queue/route";

const PASSCODE = "test-passcode-not-a-real-one";
const AUTH = { cookie: `staff_session=${PASSCODE}`, "x-staff-actor": "tm1-test" };

/* ── fixtures. Pseudonyms only (CLAUDE.md rule 6). ───────────────────────── */

let seq = 0;
const id = (): Uuid => `cccccccc-0000-0000-0000-${String(++seq).padStart(12, "0")}`;

function person(pseudonym: string): Person {
  return {
    id: id(),
    pseudonym,
    language: "en",
    is_minor_flag: false,
    baseline_mean: 30,
    baseline_var: 4,
    checkin_count: 3,
    missed_count: 0,
    created_at: "2026-08-01T09:00:00+05:30",
  };
}

function assessment(personId: Uuid, tier: Tier, createdAt: string): Assessment {
  return {
    id: id(),
    checkin_id: id(),
    person_id: personId,
    components: { s1: 50, s2: 40, s3: 60, s4: 0, s5: null },
    contributions: { s1: 17.5, s2: 10, s3: 15, s4: 0, s5: null },
    composite: 42.5,
    z_score: 1.5,
    change_point: false,
    tier,
    trigger_source: "policy",
    explanation: ["fixture"],
    policy_version: "1.1.0",
    model_version: "none:not-consulted+prompt-1.0.0",
    created_at: createdAt,
  };
}

function alert(a: Assessment, overrides: Partial<Alert> = {}): Alert {
  return {
    id: id(),
    assessment_id: a.id,
    person_id: a.person_id,
    tier: a.tier,
    sla_minutes: a.tier === "CRITICAL" ? 0 : 30,
    created_at: a.created_at,
    acked_at: null,
    acked_by: null,
    disposition: null,
    ...overrides,
  };
}

/* ── the fake Db ─────────────────────────────────────────────────────────── */

interface Recorder {
  audits: AuditInsert[];
  acks: { alertId: Uuid; input: AckInput }[];
}

function fakeDb(options: { rows?: QueueRow[]; alert?: Alert | null }): {
  db: Db;
  recorder: Recorder;
} {
  const recorder: Recorder = { audits: [], acks: [] };
  const unused = (what: string) => async (): Promise<never> => {
    throw new Error(`fakeDb.${what} is not part of the staff read path`);
  };

  const db = {
    loadPerson: unused("loadPerson"),
    loadLiveConsent: unused("loadLiveConsent"),
    loadCase: unused("loadCase"),
    insertCheckIn: unused("insertCheckIn"),
    insertAssessment: unused("insertAssessment"),
    insertAlert: unused("insertAlert"),
    updateBaseline: unused("updateBaseline"),
    loadPersonDetail: unused("loadPersonDetail"),
    async loadQueueRows() {
      return options.rows ?? [];
    },
    async loadAlert() {
      return options.alert ?? null;
    },
    async ackAlert(alertId: Uuid, input: AckInput) {
      const current = options.alert;
      if (!current) throw new Error("no alert");
      if (current.acked_at !== null) throw new AlertAlreadyAckedError(alertId);
      recorder.acks.push({ alertId, input });
      return {
        ...current,
        acked_at: "2026-09-01T10:00:00+05:30",
        acked_by: input.acked_by,
        disposition: input.disposition,
      };
    },
    async writeAudit(event: AuditInsert) {
      recorder.audits.push(event);
    },
  } as unknown as Db;

  return { db, recorder };
}

let savedPasscode: string | undefined;

beforeEach(() => {
  savedPasscode = process.env.STAFF_PASSCODE;
  process.env.STAFF_PASSCODE = PASSCODE;
});

afterEach(() => {
  __setDbForTests(null);
  if (savedPasscode === undefined) delete process.env.STAFF_PASSCODE;
  else process.env.STAFF_PASSCODE = savedPasscode;
});

/* ── the gate ────────────────────────────────────────────────────────────── */

test("the queue API is gated on its own, not just the page (T3-A7)", async () => {
  const { db, recorder } = fakeDb({ rows: [] });
  __setDbForTests(db);

  const anonymous = await queue(new Request("http://x/api/staff/queue"));
  assert.equal(anonymous.status, 401);

  const wrong = await queue(
    new Request("http://x/api/staff/queue", { headers: { cookie: "staff_session=nope" } }),
  );
  assert.equal(wrong.status, 401);

  assert.equal(recorder.audits.length, 0, "a refused request read nothing, so it audits nothing");
});

test("an unset STAFF_PASSCODE fails closed, it does not open the door", async () => {
  const { db } = fakeDb({ rows: [] });
  __setDbForTests(db);
  delete process.env.STAFF_PASSCODE;

  const response = await queue(new Request("http://x/api/staff/queue", { headers: AUTH }));
  assert.equal(response.status, 503);
});

/* ── the queue ───────────────────────────────────────────────────────────── */

test("the queue is unacked first, then most severe, then longest waiting", async () => {
  const green = person("A-1001");
  const amberOld = person("A-1002");
  const amberNew = person("A-1003");
  const redAcked = person("A-1004");
  const critical = person("A-1005");

  const rows: QueueRow[] = [
    // Deliberately out of order on the way in.
    (() => {
      const a = assessment(green.id, "GREEN", "2026-09-01T08:00:00+05:30");
      return { person: green, assessment: a, alert: null };
    })(),
    (() => {
      const a = assessment(redAcked.id, "RED", "2026-09-01T07:00:00+05:30");
      return {
        person: redAcked,
        assessment: a,
        alert: alert(a, { acked_at: "2026-09-01T07:05:00+05:30", acked_by: "tm3" }),
      };
    })(),
    (() => {
      const a = assessment(amberNew.id, "AMBER", "2026-09-01T09:30:00+05:30");
      return { person: amberNew, assessment: a, alert: alert(a) };
    })(),
    (() => {
      const a = assessment(critical.id, "CRITICAL", "2026-09-01T09:00:00+05:30");
      return { person: critical, assessment: a, alert: alert(a) };
    })(),
    (() => {
      const a = assessment(amberOld.id, "AMBER", "2026-09-01T06:00:00+05:30");
      return { person: amberOld, assessment: a, alert: alert(a) };
    })(),
  ];

  const { db, recorder } = fakeDb({ rows });
  __setDbForTests(db);

  const response = await queue(new Request("http://x/api/staff/queue", { headers: AUTH }));
  const items = (await response.json()) as { pseudonym: string; acked: boolean; slaMinutes: number }[];

  assert.equal(response.status, 200);
  assert.deepEqual(
    items.map((i) => i.pseudonym),
    [
      "A-1005", // unacked CRITICAL
      "A-1002", // unacked AMBER, waiting since 06:00
      "A-1003", // unacked AMBER, arrived 09:30
      "A-1004", // acked RED sinks below every unacked row
      "A-1001", // GREEN raised no alert, so there is nothing outstanding
    ],
    "risk-sorted, unacked first, oldest first inside a tier",
  );

  const greenRow = items.find((i) => i.pseudonym === "A-1001")!;
  assert.equal(greenRow.acked, true, "no alert means nothing outstanding, not unhandled");
  assert.equal(greenRow.slaMinutes, 10080, "GREEN's SLA comes from policy/v1.yaml");

  assert.deepEqual(
    recorder.audits.map((a) => [a.actor, a.action, a.subject_id]),
    [["tm1-test", "view_queue", null]],
    "one audit row per queue read (T3-C6)",
  );
});

test("?tier= is validated against the contract enum", async () => {
  const { db } = fakeDb({ rows: [] });
  __setDbForTests(db);

  const bad = await queue(new Request("http://x/api/staff/queue?tier=PURPLE", { headers: AUTH }));
  assert.equal(bad.status, 400);
});

/* ── the ack ─────────────────────────────────────────────────────────────── */

function ackRequest(body?: unknown): Request {
  return new Request("http://x", {
    method: "POST",
    headers: { ...AUTH, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const ALERT_ID = "dddddddd-0000-0000-0000-000000000001";
const params = { params: Promise.resolve({ id: ALERT_ID }) };

test("a CRITICAL alert cannot be closed without an explicit disposition", async () => {
  const critical = person("A-2001");
  const a = assessment(critical.id, "CRITICAL", "2026-09-01T09:00:00+05:30");
  const { db, recorder } = fakeDb({ alert: { ...alert(a), id: ALERT_ID } });
  __setDbForTests(db);

  const empty = await ack(ackRequest(), params);
  assert.equal(empty.status, 400, "an empty body must not close a CRITICAL");

  const pending = await ack(ackRequest({ disposition: "pending" }), {
    params: Promise.resolve({ id: ALERT_ID }),
  });
  assert.equal(pending.status, 400, "'pending' is the state it is already in, not a decision");

  assert.equal(recorder.acks.length, 0, "nothing was written on either refusal");
});

test("a CRITICAL closes on an explicit disposition, and audits twice", async () => {
  const critical = person("A-2002");
  const a = assessment(critical.id, "CRITICAL", "2026-09-01T09:00:00+05:30");
  const { db, recorder } = fakeDb({ alert: { ...alert(a), id: ALERT_ID } });
  __setDbForTests(db);

  const response = await ack(ackRequest({ disposition: "contacted" }), params);
  const body = (await response.json()) as Alert;

  assert.equal(response.status, 200);
  assert.equal(body.disposition, "contacted");
  assert.equal(body.acked_by, "tm1-test", "the handle from the staff session");
  assert.ok(body.acked_at !== null);

  assert.deepEqual(
    recorder.audits.map((x) => x.action),
    ["ack_alert", "dispose"],
    "acknowledging and dispositioning are two claims about what a human did",
  );
});

test("a lower tier may be acknowledged without a disposition", async () => {
  const amber = person("A-2003");
  const a = assessment(amber.id, "AMBER", "2026-09-01T09:00:00+05:30");
  const { db, recorder } = fakeDb({ alert: { ...alert(a), id: ALERT_ID } });
  __setDbForTests(db);

  const response = await ack(ackRequest(), params);
  const body = (await response.json()) as Alert;

  assert.equal(response.status, 200);
  assert.equal(body.disposition, "pending", "seen, not yet dispositioned");
  assert.deepEqual(recorder.audits.map((x) => x.action), ["ack_alert"]);
});

test("a second ack loses safely rather than overwriting the first", async () => {
  const red = person("A-2004");
  const a = assessment(red.id, "RED", "2026-09-01T09:00:00+05:30");
  const already = alert(a, {
    id: ALERT_ID,
    acked_at: "2026-09-01T09:10:00+05:30",
    acked_by: "tm3",
    disposition: "contacted",
  });
  const { db, recorder } = fakeDb({ alert: already });
  __setDbForTests(db);

  const response = await ack(ackRequest({ disposition: "escalated" }), params);
  assert.equal(response.status, 409);
  assert.equal(recorder.acks.length, 0, "the first counsellor's disposition stands");
});

test("acked_by refuses anything that is not a handle (CLAUDE.md rule 6)", async () => {
  const amber = person("A-2005");
  const a = assessment(amber.id, "AMBER", "2026-09-01T09:00:00+05:30");
  const { db } = fakeDb({ alert: { ...alert(a), id: ALERT_ID } });
  __setDbForTests(db);

  // Deliberately not a realistic name, even here: CLAUDE.md rule 6 does not
  // carve out test files. What is being tested is the shape — anything with a
  // space in it is prose, and prose in `acked_by` is how a real name gets into
  // the database.
  const response = await ack(ackRequest({ ackedBy: "two words" }), params);
  assert.equal(response.status, 400, "anything with a space in it is not a staff handle");
});

test("an unknown alert is a 404, not a silent success", async () => {
  const { db } = fakeDb({ alert: null });
  __setDbForTests(db);

  const response = await ack(ackRequest({ disposition: "contacted" }), params);
  assert.equal(response.status, 404);
});

/* ── sign-in ─────────────────────────────────────────────────────────────── */

function signIn(body: Record<string, string>, form = false): Request {
  if (form) {
    const encoded = new URLSearchParams(body);
    return new Request("http://x/api/staff/auth", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: encoded,
    });
  }
  return new Request("http://x/api/staff/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("sign-in sets an httpOnly, sameSite=lax session cookie (T3-A6)", async () => {
  const response = await auth(signIn({ passcode: PASSCODE }));
  assert.equal(response.status, 200);

  const [session] = response.headers.getSetCookie();
  assert.ok(session.startsWith(`staff_session=`), `unexpected cookie: ${session}`);
  assert.match(session, /HttpOnly/);
  assert.match(session, /SameSite=Lax/);
  assert.match(session, /Path=\//);
});

test("the cookie sign-in issues is the one the gate accepts", async () => {
  const { db } = fakeDb({ rows: [] });
  __setDbForTests(db);

  const signedIn = await auth(signIn({ passcode: PASSCODE }));
  const cookie = signedIn.headers.getSetCookie()[0].split(";")[0];

  const response = await queue(new Request("http://x/api/staff/queue", { headers: { cookie } }));
  assert.equal(response.status, 200, "sign-in and the gate must agree on the cookie");
});

test("a wrong passcode is 401 and sets no cookie", async () => {
  const response = await auth(signIn({ passcode: "not-the-passcode" }));

  assert.equal(response.status, 401);
  assert.equal(response.headers.getSetCookie().length, 0, "a failed sign-in issues nothing");

  const body = (await response.json()) as { message: string };
  assert.ok(
    !body.message.includes(PASSCODE),
    "the refusal must not echo the expected passcode back",
  );
});

test("sign-in fails closed when STAFF_PASSCODE is unset", async () => {
  delete process.env.STAFF_PASSCODE;

  const response = await auth(signIn({ passcode: "anything" }));
  assert.equal(response.status, 503, "no passcode configured is not a door, it is a 503");
  assert.equal(response.headers.getSetCookie().length, 0);
});

test("sign-in accepts a plain form post as well as JSON", async () => {
  const response = await auth(signIn({ passcode: PASSCODE }, true));
  assert.equal(response.status, 200);
  assert.ok(response.headers.getSetCookie()[0].startsWith("staff_session="));
});

test("a missing passcode is a 400, not a 401", async () => {
  const response = await auth(signIn({}));
  assert.equal(response.status, 400);
});

test("an optional handle is carried into the audit trail, a name is not", async () => {
  const withHandle = await auth(signIn({ passcode: PASSCODE, actor: "tm3" }));
  const cookies = withHandle.headers.getSetCookie();
  assert.equal(cookies.length, 2);
  assert.ok(cookies[1].startsWith("staff_actor=tm3"));
  assert.match(cookies[1], /HttpOnly/);

  // Anything that is not a handle is dropped, and the audit falls back to the
  // default actor — signing in is not the moment to argue about a username.
  const withName = await auth(signIn({ passcode: PASSCODE, actor: "two words" }));
  assert.equal(withName.headers.getSetCookie().length, 1);
});
