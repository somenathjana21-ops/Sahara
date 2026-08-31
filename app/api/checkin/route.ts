/**
 * POST /api/checkin — the pipeline.
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 7 (Prompt 9), in the ten
 * steps that document lists, in that order.
 *
 * ```
 *   1  validate                    types/contract.ts
 *   2  consent gate                403, and NOTHING written  (S6)
 *   3  minor                       fixed reply, no assessment (S10, rule 10)
 *   4  PASS 1 interlock            hit => CRITICAL, model never called (S1)
 *   5  the model                   unavailable => S2 null, keep going (S5)
 *   6  PASS 2 interlock            rejected => fixed fallback (S4)
 *   7  S1..S5, composite, baseline SCORING_AND_POLICY.md 2-7
 *   8  policy => tier              a deterministic tier may only rise (S7)
 *   9  checkin / assessment / alert
 *  10  CheckInResponse
 * ```
 *
 * ## Two orderings in here are safety properties, not style
 *
 * **`checkInput` (step 4) runs before `loadPolicy` (step 8), and the lexicon
 * branch returns without ever reaching it.** `loadPolicy` throws when `TZ` is
 * unpinned (assertTimezonePinned in lib/policy/engine.ts). That guard is right
 * — a silently wrong date is worse than a failed boot — but it is one more way
 * this handler can 500, and SAFETY_SPEC.md section 1 says the crisis path must
 * not depend on anything that can be misconfigured. Ordered the other way, one
 * missing environment variable turns "I want to kill myself" into a 500 with no
 * helpline number in it. Scoring may fail closed; Pass 1 may not.
 * (CHECKS_TM1.md T1-B5a.)
 *
 * **The model sits between the two interlock passes and outside both.** Pass 1
 * decides CRITICAL before the model is reachable, and Pass 2 judges what it
 * said before a person reads it (CLAUDE.md rules 1 and 2, CHECKS_TM1.md T1-B5).
 *
 * ## What this handler may never do
 *
 * Write safety-critical text (every fixed string comes from lib/safety/replies.ts,
 * CLAUDE.md rule 3), let a model produce or lower a tier (rule 4, enforced in
 * lib/policy/engine.ts), lower a score because someone went quiet (rule 5), or
 * put a name, phone number or case number in any row it writes (rule 6).
 */

import { getDb, type AssessmentInsert, type CheckInInsert } from "@/lib/db";
import {
  LLMUnavailableError,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  UnknownProviderError,
  buildTurn,
  complete,
} from "@/lib/llm";
import {
  assignTier,
  compositeWeights,
  escalationFor,
  loadPolicy,
  type DeterministicTrigger,
  type Policy,
} from "@/lib/policy/engine";
import { checkInput, checkOutput } from "@/lib/safety/interlock";
import { HELPLINES, reply as fixedReply, type ReplyLang } from "@/lib/safety/replies";
import { isChangePoint, updateEWMA, zScore } from "@/lib/scoring/baseline";
import { computeComposite } from "@/lib/scoring/composite";
import {
  extractS5,
  q3IsCriticalTrigger,
  scoreS1,
  scoreS3,
  scoreS4,
} from "@/lib/scoring/components";
import {
  CheckInRequestSchema,
  CheckInResponseSchema,
  type CheckInResponse,
  type ComponentContributions,
  type ComponentScores,
  type CrisisResource,
  type Explanation,
  type StructuredAnswers,
  type Uuid,
} from "@/types/contract";

/** loadPolicy reads policy/v1.yaml from disk, so this handler needs Node, not Edge. */
export const runtime = "nodejs";
/** Every request reads the database and the clock. Nothing here may be cached. */
export const dynamic = "force-dynamic";

/* ── constants ───────────────────────────────────────────────────────────── */

/**
 * `assessments.model_version` when no model produced anything. Both values
 * keep the `<provider>:<modelId>+prompt-<version>` shape so the column can
 * still be split on `+` (SAFETY_SPEC.md section 7), and both say plainly that
 * S2 on this row is absent rather than zero.
 */
const MODEL_NOT_CONSULTED = `none:not-consulted+prompt-${PROMPT_VERSION}`;
const MODEL_UNAVAILABLE = `none:unavailable+prompt-${PROMPT_VERSION}`;

/**
 * `assessments.policy_version` on the lexicon short-circuit.
 *
 * That row is deliberately UNSCORED: reaching the policy would mean reaching
 * `loadPolicy`, which the crisis path may not do (T1-B5a, and the header
 * above). The column still has to say something true on every insert path
 * (CHECKS_TM1.md T1-C8), and "no policy was applied" is what is true.
 */
const CRISIS_POLICY_VERSION = "unscored:crisis-short-circuit";

/**
 * CRITICAL's SLA, hardcoded for the crisis path only.
 *
 * Everywhere else this comes from `escalation` in policy/v1.yaml. Here it
 * cannot, for the reason above, so it is pinned to the one value that fails
 * safe: 0 means "now". A policy that widened CRITICAL's SLA would not be
 * honoured on this path, deliberately — this branch already knows a person is
 * in danger, and no configuration file gets to add minutes to that.
 */
const CRISIS_SLA_MINUTES = 0;

/** Every component null. Used only where nothing was scored. */
const NO_COMPONENTS: ComponentScores = { s1: null, s2: null, s3: null, s4: null, s5: null };
const NO_CONTRIBUTIONS: ComponentContributions = {
  s1: null,
  s2: null,
  s3: null,
  s4: null,
  s5: null,
};

/* ── helpers ─────────────────────────────────────────────────────────────── */

function json(body: unknown, status: number, elapsedMs?: number): Response {
  const headers: Record<string, string> =
    elapsedMs === undefined
      ? {}
      : // Standard Server-Timing, so the crisis-path budget is visible in
        // devtools and readable by the latency test without a debug endpoint
        // (CHECKS_TM1.md T1-C11).
        { "Server-Timing": `checkin;dur=${elapsedMs.toFixed(1)}` };
  return Response.json(body, { status, headers });
}

/**
 * The crisis card's numbers, from the fixed reply bank and nowhere else
 * (CLAUDE.md rule 3). The LLM never contributes a helpline number.
 */
function crisisResources(lang: ReplyLang): CrisisResource[] {
  return HELPLINES.map((helpline) => ({
    label: helpline.label[lang],
    phone: helpline.phone,
  }));
}

/** One structured log line. Never carries the person's words or the model's. */
function logEvent(event: string, fields: Record<string, unknown>): void {
  console.warn(JSON.stringify({ event, ...fields }));
}

/* ── the handler ─────────────────────────────────────────────────────────── */

export async function POST(request: Request): Promise<Response> {
  const started = performance.now();

  /* ── Step 1 — validate the body against CheckInRequest ─────────────────── */

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid_json", message: "Request body must be JSON." }, 400);
  }

  const parsed = CheckInRequestSchema.safeParse(body);
  if (!parsed.success) {
    return json({ error: "invalid_request", issues: parsed.error.issues }, 400);
  }

  const req = parsed.data;
  // A whitespace-only transcript is no transcript: it must not be handed to
  // the model, and `checkInput` would normalise it away anyway.
  const transcript =
    req.transcript !== undefined && req.transcript.trim() !== "" ? req.transcript : null;
  const structured: StructuredAnswers = req.structured ?? {};
  const db = getDb();

  /* ── Step 2 — the consent gate ─────────────────────────────────────────── */

  const [person, consent] = await Promise.all([
    db.loadPerson(req.personId),
    db.loadLiveConsent(req.consentId, req.personId),
  ]);

  if (person === null) {
    return json(
      { error: "person_not_found", message: "No such person." },
      404,
      performance.now() - started,
    );
  }

  /*
   * No live consent row => 403, and NOTHING is written to checkins or
   * assessments (SAFETY_SPEC.md section 8 test S6, CHECKS_TM1.md T1-C9). Note
   * where this sits: above every insert in this file, so there is no path on
   * which a row is written first and the refusal happens after. Withdrawn
   * consent, a consent id belonging to someone else, and no consent at all all
   * arrive here identically — see loadLiveConsent.
   */
  if (consent === null) {
    return json(
      {
        error: "consent_required",
        message: "This check-in cannot be recorded without live consent.",
      },
      403,
      performance.now() - started,
    );
  }

  const lang: ReplyLang = person.language;

  const checkInRow: CheckInInsert = {
    person_id: person.id,
    consent_id: consent.id,
    channel: req.channel,
    transcript,
    structured,
    /*
     * CheckInRequest carries no abandonment flag, so this is always false.
     * A dropped call cannot report itself — the flag would have to be written
     * by whatever notices the line went dead, which the MVP does not have. S4's
     * abandonment clause is therefore dormant on this route and live in the
     * eval sets. Noted for the PR description; do not "fix" it by inferring
     * abandonment from a short transcript.
     */
    abandoned: false,
  };

  /* ── Step 3 — minor: human route, no scoring ───────────────────────────── */

  /*
   * CLAUDE.md rule 10 and SAFETY_SPEC.md test S10: any minor indicator routes
   * to a human and writes ZERO assessment rows. The check-in itself is still
   * recorded, because a support worker needs to know the contact happened.
   * Nothing below this line runs: no lexicon pass, no model, no score.
   */
  if (person.is_minor_flag) {
    await db.insertCheckIn(checkInRow);
    /*
     * `tier` and `assessmentId` are OMITTED, not filled in. There is no
     * assessment row to point at and no tier was assigned, and this response
     * used to carry a nil UUID and a GREEN because the contract required both
     * — a GREEN that read as "low risk" for a person the system deliberately
     * refused to score. types/contract.ts made both optional on Day 4 for this
     * path. A consumer seeing no tier must read it as "not scored, routed to a
     * human", never as "safe".
     */
    return json(
      CheckInResponseSchema.parse({
        reply: fixedReply("minor_detected", lang),
      } satisfies CheckInResponse),
      200,
      performance.now() - started,
    );
  }

  /* ── Step 4 — PASS 1, before any model call ────────────────────────────── */

  const pass1 = transcript === null ? { hit: false as const } : checkInput(transcript);

  if (pass1.hit) {
    /*
     * CRITICAL, deterministically, from a regex over the person's own words.
     * The model is not consulted and cannot override this (SAFETY_SPEC.md
     * section 3). Resources go back in THIS response, not a second fetch.
     *
     * The assessment row is written UNSCORED — every component null, composite
     * 0, contributions null — and that is not an omission. Scoring here would
     * mean loading the policy for its weights and reading S3 off the calendar,
     * both of which depend on a correctly pinned TZ; the whole point of this
     * branch is that it survives a misconfigured server. The null contributions
     * also make the row un-renderable as a score, which is the right outcome:
     * CLAUDE.md rule 8 forbids drawing a composite without its breakdown, and
     * there is no breakdown here because nothing was measured.
     *
     * TM3: do not plot this row on the trend line. Composite 0 means NOT
     * SCORED, never calm.
     */
    const checkin = await db.insertCheckIn(checkInRow);

    const assessment = await db.insertAssessment({
      checkin_id: checkin.id,
      person_id: person.id,
      components: NO_COMPONENTS,
      contributions: NO_CONTRIBUTIONS,
      composite: 0,
      z_score: null,
      change_point: false,
      tier: "CRITICAL",
      trigger_source: "lexicon",
      explanation: [
        `CRITICAL set deterministically by a lexicon match on the person's own words (category ${pass1.category ?? "unknown"}, matched "${pass1.matched ?? ""}").`,
        "The model was never called and nothing was scored: a deterministic crisis trigger does not go through the composite (SAFETY_SPEC.md section 3).",
        "Composite 0 with every component null means NOT SCORED. It is not a measurement of calm and must not be drawn on the trend line.",
        "Crisis resources were shown to the person in the same response. Only a human closes this alert.",
      ],
      policy_version: CRISIS_POLICY_VERSION,
      model_version: MODEL_NOT_CONSULTED,
    });

    await db.insertAlert({
      assessment_id: assessment.id,
      person_id: person.id,
      tier: "CRITICAL",
      sla_minutes: CRISIS_SLA_MINUTES,
    });

    return json(
      CheckInResponseSchema.parse({
        reply: fixedReply("crisis_immediate", lang),
        tier: "CRITICAL",
        resources: crisisResources(lang),
        assessmentId: assessment.id,
      } satisfies CheckInResponse),
      200,
      performance.now() - started,
    );
  }

  /* ── Step 5 — the model ────────────────────────────────────────────────── */

  let s2: number | null = null;
  let modelVersionForRow = MODEL_NOT_CONSULTED;
  let nextQuestionId: string | undefined;
  /** null until something decides what the person reads. */
  let personFacingReply: string | null = null;
  const notes: string[] = [];

  if (transcript === null) {
    personFacingReply = fixedReply("llm_unavailable", lang);
    notes.push(
      "No transcript on this check-in, so no linguistic signal was requested and S2 is null (excluded, weights renormalised).",
    );
  } else {
    try {
      const call = await complete(SYSTEM_PROMPT, buildTurn(transcript));
      s2 = call.output.s2_score;
      modelVersionForRow = call.modelVersion;
      nextQuestionId = call.output.next_question_id;
      notes.push(
        `S2 ${call.output.s2_score} from the model; markers: ${
          call.output.markers.length === 0 ? "none" : call.output.markers.join(", ")
        }. A signal, never a decision.`,
      );

      /* ── Step 6 — PASS 2, on the model's reply, before a person reads it ── */

      const pass2 = checkOutput(call.output.reply);
      if (pass2.rejected) {
        /*
         * Discard the reply entirely and send the fixed fallback. The
         * s2_score survives: Pass 2 judges the TEXT a person would have read,
         * not the number a counsellor sees (SAFETY_SPEC.md section 6).
         *
         * The log line carries the reason class only. The rejected text is the
         * model echoing someone in distress and does not belong in a log.
         */
        personFacingReply = fixedReply("fallback_reply", lang);
        nextQuestionId = undefined;
        logEvent("pass2_rejection", { reason: pass2.reason ?? "unknown" });
        notes.push(
          `The model's reply was rejected by the Pass-2 interlock (${pass2.reason ?? "unknown"}) and replaced with the fixed fallback. The person did not read it.`,
        );
      } else {
        personFacingReply = call.output.reply;
      }
    } catch (error) {
      if (error instanceof LLMUnavailableError) {
        /*
         * The documented degradation (SAFETY_SPEC.md section 8 test S5,
         * CHECKS_TM1.md T1-D3): S2 null, the composite renormalised over
         * S1/S3/S4, the check-in still recorded and still scored. Never a 500
         * — a person mid check-in must not lose their session because a free
         * tier ran out. LLMInvalidOutputError arrives here too, by design.
         */
        s2 = null;
        modelVersionForRow = MODEL_UNAVAILABLE;
        personFacingReply = fixedReply("llm_unavailable", lang);
        logEvent("llm_unavailable", { name: error.name, provider: error.provider });
        notes.push(
          "The model was unavailable, so S2 is null: excluded and the remaining weights renormalised. A missing signal was not read as 0.",
        );
      } else if (error instanceof UnknownProviderError) {
        /*
         * LLM_PROVIDER is unset or misspelled — a deployment mistake, not
         * weather. lib/llm/types.ts keeps this class separate from
         * LLMUnavailableError precisely so it cannot degrade silently, and it
         * does not: it gets its own console.error under its own event name,
         * on every request, until someone fixes the variable.
         *
         * It still degrades rather than 500s. The person in front of the
         * screen is not the right party to punish for an env var, and the
         * check-in is scored on S1/S3/S4 either way.
         */
        console.error(
          JSON.stringify({ event: "llm_provider_misconfigured", message: error.message }),
        );
        s2 = null;
        modelVersionForRow = MODEL_UNAVAILABLE;
        personFacingReply = fixedReply("llm_unavailable", lang);
        notes.push(
          "LLM_PROVIDER is not configured on this deployment, so S2 is null and the weights were renormalised.",
        );
      } else {
        throw error;
      }
    }
  }

  /* ── Steps 7 and 8 — score, then tier ──────────────────────────────────── */

  /*
   * FIRST loadPolicy in this file, and it is below Pass 1 on purpose — see the
   * header and CHECKS_TM1.md T1-B5a. It throws on an unpinned TZ, which is
   * fail-closed for the scored path: 503 with nothing written and a log line
   * naming the variable, rather than a composite that is quietly 40 points
   * light because the server read yesterday's date.
   */
  let policy: Policy;
  try {
    policy = loadPolicy();
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "policy_unavailable",
        message: (error as Error).message,
      }),
    );
    return json(
      {
        error: "policy_unavailable",
        message: "Scoring is not available on this deployment.",
      },
      503,
    );
  }

  /*
   * The check-in is recorded BEFORE it is scored. Prompt 9 lists the insert at
   * step 9; writing it here instead means a failure anywhere in the scorer
   * loses the assessment but never loses what the person said. The assessment
   * and the alert still follow in step 9, in that order, below.
   */
  const checkin = await db.insertCheckIn(checkInRow);

  /*
   * `today` is read once and passed in. S3's two time-windowed rows are
   * evaluated against the process's LOCAL calendar date, which is why TZ is
   * pinned above (SCORING_AND_POLICY.md section 5).
   */
  const today = new Date();
  const caseRow = await db.loadCase(person.id);

  const s1 = scoreS1(structured);
  const s3 = caseRow === null ? null : scoreS3(caseRow, today);
  const s4 = scoreS4(person, checkin);
  /*
   * S5 is extracted, displayed with its caveat, and weighted 0.00 — deliberate,
   * documented, and not a TODO (CLAUDE.md rule 9). There is no audio pipeline
   * on either channel in the MVP, so there are no features to extract and the
   * score is null. Its weight makes that irrelevant to the composite either way.
   */
  const s5 = extractS5(null);

  const components: ComponentScores = {
    s1,
    s2,
    s3: s3 === null ? null : s3.score,
    s4: s4.score,
    s5: s5.score,
  };

  const composite = computeComposite(components, compositeWeights(policy));

  /*
   * z BEFORE the baseline update. It is measured against the baseline as it
   * stood before this check-in; update first and every spike reads smaller
   * than it is (SCORING_AND_POLICY.md section 7, "the easy bug").
   */
  const z = zScore(
    composite.composite,
    person.baseline_mean,
    person.baseline_var,
    policy.baseline.sigma_floor,
  );
  const changePoint = isChangePoint(
    z,
    person.checkin_count,
    policy.baseline.change_point_z,
    policy.baseline.min_history_for_change_point,
  );

  /*
   * SAFETY_SPEC.md section 3's fourth trigger: q3 answered "not safe" is
   * CRITICAL on its own. Unlike a lexicon hit it does not skip the model — it
   * is read at scoring time, from the keypad, and the model has already
   * answered by now. It becomes a FLOOR that assignTier may raise and may
   * never lower (CLAUDE.md rule 4).
   */
  const deterministic: DeterministicTrigger | null = q3IsCriticalTrigger(structured)
    ? { tier: "CRITICAL", source: "self_report_q3" }
    : null;

  const decision = assignTier(
    composite.composite,
    z,
    changePoint,
    components.s3,
    z === null,
    person.missed_count,
    policy,
    deterministic,
  );

  /*
   * Advance the person's own baseline. This is what "dynamic" means: the next
   * check-in is measured against this person's history, not a population
   * threshold. `checkin_count` moves with it because it IS the history count
   * the change-point rule reads.
   */
  const nextBaseline = updateEWMA(
    person.baseline_mean,
    person.baseline_var,
    composite.composite,
    policy.baseline.ewma_lambda,
  );
  await db.updateBaseline(person.id, {
    baseline_mean: nextBaseline.mean,
    baseline_var: nextBaseline.variance,
    checkin_count: person.checkin_count + 1,
  });

  /* ── Step 9 — the assessment, and an alert if RED or CRITICAL ──────────── */

  const explanation: Explanation = [
    ...decision.explanation,
    ...composite.reasons,
    ...(s3 === null
      ? ["No case row for this person, so S3 was excluded and the weights renormalised."]
      : s3.reasons),
    ...s4.reasons,
    `S5 acoustic: ${s5.caveat}`,
    ...notes,
  ];

  const assessmentRow: AssessmentInsert = {
    checkin_id: checkin.id,
    person_id: person.id,
    components,
    contributions: composite.contributions,
    composite: composite.composite,
    z_score: z,
    change_point: changePoint,
    tier: decision.tier,
    trigger_source: decision.triggerSource,
    explanation,
    // Every row says which policy scored it and which model spoke on it
    // (CLAUDE.md; CHECKS_TM1.md T1-C8).
    policy_version: policy.version,
    model_version: modelVersionForRow,
  };
  const assessment = await db.insertAssessment(assessmentRow);

  const isCritical = decision.tier === "CRITICAL";
  if (isCritical || decision.tier === "RED") {
    await db.insertAlert({
      assessment_id: assessment.id,
      person_id: person.id,
      tier: decision.tier,
      sla_minutes: escalationFor(policy, decision.tier).sla_minutes,
    });
  }

  /* ── Step 10 — the response ────────────────────────────────────────────── */

  /*
   * A CRITICAL reply is a fixed string and its resources come from the reply
   * bank, whatever the model said and whether or not it was consulted
   * (CLAUDE.md rule 3, SAFETY_SPEC.md section 3: resources render in the same
   * response). The model's next question is dropped on that path — a person
   * being handed a helpline number is not also being asked about their sleep.
   */
  const responseBody: CheckInResponse = {
    reply: isCritical
      ? fixedReply("crisis_immediate", lang)
      : (personFacingReply ?? fixedReply("fallback_reply", lang)),
    tier: decision.tier,
    ...(isCritical ? { resources: crisisResources(lang) } : {}),
    assessmentId: assessment.id as Uuid,
    ...(!isCritical && nextQuestionId !== undefined ? { nextQuestionId } : {}),
  };

  // Parsed on the way out as well as on the way in: a response that has
  // drifted from the contract should fail here, not in TM2's client.
  return json(CheckInResponseSchema.parse(responseBody), 200);
}
