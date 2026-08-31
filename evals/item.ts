/**
 * evals/item.ts — the eval item schema and its materialisation into contract rows.
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 6, Prompt 7, and the tuning
 * loop in docs/SCORING_AND_POLICY.md section 10.
 *
 * One JSONL line is one check-in as it would arrive at POST /api/checkin, plus
 * the person and case state behind it, plus the tier a human says it should
 * come out as. `run.ts` turns each line into the same `Person`, `Case` and
 * `CheckIn` rows the route handler works with and pushes them through the real
 * lib/ code — an eval that reimplements scoring stops measuring what ships.
 *
 * ## Why the case dates are RELATIVE
 *
 * Two of S3's seven rows are time-windowed (SCORING_AND_POLICY.md section 5):
 * "intimidation report in the last 14 days" and "next hearing within 7 days".
 * An absolute date in a fixture rots — a hearing dated 2026-09-05 is inside
 * the window this week and outside it next week, and the same file would
 * silently report different numbers in October than it did in August.
 *
 * So the file stores offsets in days and `materialise()` resolves them against
 * the run date. The set is then deterministic forever, and it exercises the
 * real calendar arithmetic in `scoreS3` instead of working around it.
 *
 * ## NO PII (CLAUDE.md rule 6)
 *
 * `id` is the persona pseudonym and the only identifier in the file. Every
 * scenario is invented. No name, no phone, no email, no real case number, and
 * no place-plus-incident pair that could be matched to an actual case.
 * CHECKS_TM1.md T1-E4 greps for exactly that and is a BLOCKER.
 */

import { z } from "zod";
import {
  type Case,
  CaseSchema,
  type CheckIn,
  CheckInSchema,
  type Person,
  PersonSchema,
  BailStatusSchema,
  CaseStageSchema,
  ChannelSchema,
  StructuredAnswersSchema,
  TierSchema,
} from "@/types/contract";

/* ── the item ────────────────────────────────────────────────────────────── */

/**
 * The three written forms, matching `LexiconLang` in lib/safety/lexicon.ts and
 * NOT `Language` in types/contract.ts.
 *
 * Per-language recall is reported over these three and never averaged
 * (SAFETY_SPEC.md section 8). Romanised Hindi is a separate matching problem
 * to a regular expression and is "the form teams forget" — folding it into
 * 'hi' would hide the exact failure this project exists to avoid.
 */
export const EvalLangSchema = z.enum(["en", "hi", "hi-rom"]);
export type EvalLang = z.infer<typeof EvalLangSchema>;

/** The six categories named in TM1_GUIDE.md section 6, Prompt 7. */
export const AtrocityCategorySchema = z.enum([
  "land_dispossession",
  "social_boycott",
  "threat_intimidation",
  "false_counter_case",
  "economic_exploitation",
  "workplace_discrimination",
]);
export type AtrocityCategory = z.infer<typeof AtrocityCategorySchema>;

/**
 * Everything deterministic that is true of this person and their case at the
 * moment of the check-in: the `cases` row that feeds S3, the `persons` row
 * that feeds S4, and the composite history that feeds the baseline.
 *
 * All of it is knowable from a case record and a calendar. That is the claim
 * S3 rests on (SCORING_AND_POLICY.md section 5), and the eval is where it gets
 * tested.
 */
export const CaseContextSchema = z
  .object({
    atrocityCategory: AtrocityCategorySchema,
    stage: CaseStageSchema,

    /** S3 row 1, time-windowed: 0 to 14 days inclusive scores +25. */
    daysSinceIntimidationReport: z.number().int().nullable(),
    /** S3 row 2, static: +20. */
    bailStatus: BailStatusSchema,
    /** S3 row 3, time-windowed: 0 to 7 days inclusive scores +15. */
    daysUntilHearing: z.number().int().nullable(),
    /** S3 row 4, static: strictly more than 30 scores +15. null means relief paid. */
    reliefOverdueDays: z.number().int().nullable(),
    /** S3 row 5, static: 3 or more scores +10. */
    adjournments: z.number().int().nonnegative(),
    /** S3 row 6, static: +10. */
    socialBoycott: z.boolean(),
    /** S3 row 7, static: strictly more than 365 scores +5. */
    caseAgeDays: z.number().int().nonnegative(),

    /** S4, from the `persons` row. Silence never lowers a score (CLAUDE.md rule 5). */
    missedCheckins: z.number().int().nonnegative(),
    /** S4, from this check-in: the call dropped or the chat closed mid-flow. */
    abandoned: z.boolean(),

    /**
     * This person's previous composites, oldest first. Folded through
     * `updateEWMA` to reconstruct the baseline this check-in is measured
     * against, and its length is the history count the change-point rule
     * needs. `[]` means first contact: no baseline, z is null, and the
     * first-contact floor applies instead (SCORING_AND_POLICY.md section 7).
     *
     * This is where the trajectory lives. Flat-high, rising, improving and
     * disengaging are all shapes of this array plus `missedCheckins`.
     */
    priorComposites: z.array(z.number().min(0).max(100)),
  })
  .strict();
export type CaseContext = z.infer<typeof CaseContextSchema>;

/**
 * One line of a set.
 *
 * `id` is the persona pseudonym and must match `[A-Z]-[0-9]{4}` — CHECKS_TM1.md
 * T1-E4 greps every `"id"` in evals/ against that shape and fails the build on
 * anything else.
 *
 * `transcript` is null when there is nothing for the model to read: a call that
 * dropped after the keypad answers, a chat where only the taps came through.
 * Those items are the renormalisation path (SCORING_AND_POLICY.md section 4) —
 * S2 is null, the remaining weights are rescaled over 0.75, and the composite
 * goes UP rather than down.
 */
export const EvalItemSchema = z
  .object({
    id: z
      .string()
      .regex(
        /^[A-Z]-[0-9]{4}$/,
        "persona ids are pseudonyms like A-1234 (CLAUDE.md rule 6, CHECKS_TM1.md T1-E4)",
      ),
    lang: EvalLangSchema,
    channel: ChannelSchema,
    transcript: z.string().min(1).nullable(),
    structured: StructuredAnswersSchema,
    caseContext: CaseContextSchema,
    expectedTier: TierSchema,
    notes: z.string().min(1),
  })
  .strict();
export type EvalItem = z.infer<typeof EvalItemSchema>;

/* ── loading ─────────────────────────────────────────────────────────────── */

export const SET_NAMES = ["safety", "dev", "holdout"] as const;
export type SetName = (typeof SET_NAMES)[number];

/** Minimum sizes from CHECKS_TM1.md T1-E5. */
export const MIN_SET_SIZE: Record<SetName, number> = {
  safety: 60,
  dev: 80,
  holdout: 40,
};

/**
 * Parse JSONL. Blank lines are skipped; a malformed or invalid line throws with
 * its line number, because a set that silently drops items reports recall over
 * a denominator nobody chose.
 */
export function parseJsonl(source: string, label: string): EvalItem[] {
  const items: EvalItem[] = [];
  const lines = source.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;

    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (error) {
      throw new Error(`${label}:${i + 1}: not valid JSON — ${(error as Error).message}`);
    }

    const parsed = EvalItemSchema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
      throw new Error(`${label}:${i + 1}: ${issues}`);
    }

    items.push(parsed.data);
  }

  return items;
}

/* ── materialisation ─────────────────────────────────────────────────────── */

const MS_PER_DAY = 86_400_000;

/**
 * A local calendar date `offset` days from `today`, as 'YYYY-MM-DD'.
 *
 * Built from the LOCAL calendar fields, deliberately: `scoreS3` reads `today`
 * the same way, because "the hearing is six days away" is a statement about
 * the counsellor's calendar (lib/scoring/components.ts). Building these dates
 * off the UTC fields while scoring them locally would put a half-day skew into
 * every time-windowed row. The runner pins TZ before it gets here.
 */
export function offsetDate(today: Date, offset: number): string {
  const d = new Date(
    Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) + offset * MS_PER_DAY,
  );
  return d.toISOString().slice(0, 10);
}

/**
 * A stable, obviously-synthetic UUID. Not random: two runs of the same set must
 * produce the same rows, and a row whose id changes per run is a row you cannot
 * diff between runs.
 */
function syntheticUuid(prefix: number, index: number): string {
  return `${String(prefix).repeat(8)}-0000-0000-0000-${String(index).padStart(12, "0")}`;
}

export interface MaterialisedItem {
  person: Person;
  caseRow: Case;
  checkin: CheckIn;
}

/**
 * Fold the prior composites into the EWMA state carried on the `persons` row.
 *
 * `updateFn` is `updateEWMA` from lib/scoring/baseline.ts, passed in with the
 * policy's lambda already bound rather than reimplemented here. A change to
 * `ewma_lambda` in policy/v1.yaml must move the eval and the product together.
 */
export function foldBaseline(
  priorComposites: readonly number[],
  updateFn: (
    mean: number | null,
    variance: number | null,
    x: number,
  ) => { mean: number; variance: number },
): { mean: number | null; variance: number | null } {
  let mean: number | null = null;
  let variance: number | null = null;

  for (const x of priorComposites) {
    const next = updateFn(mean, variance, x);
    mean = next.mean;
    variance = next.variance;
  }

  return { mean, variance };
}

/**
 * Turn one eval line into the three contract rows the scoring code reads.
 *
 * Every row is validated against types/contract.ts on the way out. If an item
 * cannot produce a legal row that is a bug in the set, and it should stop the
 * run rather than quietly score something the database would reject.
 *
 * `consent_id` is a real value on every row: an eval item is a check-in that
 * already got past the consent gate (TM1_GUIDE.md section 7, Prompt 9 step 2).
 * The gate itself is route-level and is covered by acceptance test S6, not here.
 */
export function materialise(
  item: EvalItem,
  index: number,
  today: Date,
  baseline: { mean: number | null; variance: number | null },
): MaterialisedItem {
  const personId = syntheticUuid(1, index);
  const ctx = item.caseContext;

  const person = PersonSchema.parse({
    id: personId,
    pseudonym: item.id,
    // The eval's three written forms collapse to the person's two languages:
    // romanised Hindi is Hindi to the person holding the phone.
    language: item.lang === "en" ? "en" : "hi",
    // Any minor indicator routes to a human workflow and is never scored
    // (CLAUDE.md rule 10), so a minor cannot appear in a set that measures
    // scoring. There is no minor in any of the three files.
    is_minor_flag: false,
    baseline_mean: baseline.mean,
    baseline_var: baseline.variance,
    checkin_count: ctx.priorComposites.length,
    missed_count: ctx.missedCheckins,
    created_at: `${offsetDate(today, -ctx.caseAgeDays)}T09:00:00+05:30`,
  });

  const caseRow = CaseSchema.parse({
    id: syntheticUuid(3, index),
    person_id: personId,
    atrocity_category: ctx.atrocityCategory,
    stage: ctx.stage,
    next_hearing_date:
      ctx.daysUntilHearing === null ? null : offsetDate(today, ctx.daysUntilHearing),
    adjournment_count: ctx.adjournments,
    bail_status: ctx.bailStatus,
    relief_due_date:
      ctx.reliefOverdueDays === null ? null : offsetDate(today, -ctx.reliefOverdueDays),
    // A null overdue count means nothing is outstanding, which S3 row 4 reads
    // as paid. It must not read as "due today".
    relief_paid: ctx.reliefOverdueDays === null,
    social_boycott_flag: ctx.socialBoycott,
    last_intimidation_report:
      ctx.daysSinceIntimidationReport === null
        ? null
        : offsetDate(today, -ctx.daysSinceIntimidationReport),
    opened_at: offsetDate(today, -ctx.caseAgeDays),
  });

  const checkin = CheckInSchema.parse({
    id: syntheticUuid(4, index),
    person_id: personId,
    consent_id: syntheticUuid(2, index),
    channel: item.channel,
    transcript: item.transcript,
    structured: item.structured,
    abandoned: ctx.abandoned,
    created_at: `${offsetDate(today, 0)}T09:30:00+05:30`,
  });

  return { person, caseRow, checkin };
}
