/**
 * evals/run.ts — the eval harness.
 *
 *   npm run eval -- --set safety
 *   npm run eval -- --set dev --provider groq
 *   npm run eval -- --set holdout          # once, on Day 4, and never again
 *
 * Owner: TM1. Implements docs/TM1_GUIDE.md section 6 (Prompt 7), the tuning
 * loop in docs/SCORING_AND_POLICY.md section 10, and acceptance tests S1 and
 * S2 in docs/SAFETY_SPEC.md section 8.
 *
 * ## What it prints, and the one thing it does not
 *
 * A confusion matrix of expected against assigned tier, recall on CRITICAL,
 * per-language recall as SEPARATE rows, the Pass-2 rejection count, and mean
 * latency.
 *
 * It never prints a single-number correctness rate, and CHECKS_TM1.md T1-E1
 * greps this program's output to make sure it never starts. The base rate of a
 * genuine crisis in this population is around 0.5%, so a system that answered
 * "everyone is fine" to every check-in would score 99.5% and would be worth
 * nothing. The numbers that mean something are recall on the cases that matter
 * and how that recall differs BETWEEN LANGUAGES — a per-language figure hidden
 * inside an average is exactly the failure this project exists to avoid
 * (SAFETY_SPEC.md section 8).
 *
 * ## It runs the real pipeline
 *
 * Nothing here reimplements scoring. Every item goes through the same
 * `checkInput` / `complete` / `checkOutput` / `scoreS1..S5` /
 * `computeComposite` / `assignTier` that POST /api/checkin uses, in the order
 * TM1_GUIDE.md section 7, Prompt 9 lays out. An eval with its own copy of the
 * arithmetic measures the copy.
 *
 * There is no database in this file. The rows come from evals/item.ts.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  LLMUnavailableError,
  PROVIDER_NAMES,
  SYSTEM_PROMPT,
  buildTurn,
  complete,
  getProvider,
  modelVersion,
  type LLMProvider,
} from "@/lib/llm";
import { checkInput, checkOutput } from "@/lib/safety/interlock";
import { LEXICON_VERSION } from "@/lib/safety/lexicon";
import {
  compositeWeights,
  loadPolicy,
  assignTier,
  type DeterministicTrigger,
  type Policy,
} from "@/lib/policy/engine";
import { isChangePoint, updateEWMA, zScore } from "@/lib/scoring/baseline";
import { computeComposite } from "@/lib/scoring/composite";
import {
  extractS5,
  q3IsCriticalTrigger,
  scoreS1,
  scoreS3,
  scoreS4,
} from "@/lib/scoring/components";
import type { ComponentScores, Tier } from "@/types/contract";
import {
  MIN_SET_SIZE,
  SET_NAMES,
  type EvalItem,
  type EvalLang,
  type SetName,
  foldBaseline,
  materialise,
  parseJsonl,
} from "./item";

/* ── environment ─────────────────────────────────────────────────────────── */

/**
 * `.env.local` is loaded by Next, not by a bare script, and this program is a
 * bare script. Ten lines beats a dependency (CLAUDE.md, scope discipline).
 *
 * Never overrides a variable that is already set: CI supplies the real values
 * through the job environment and must win over anything on a laptop.
 */
function loadDotEnv(file: string): void {
  if (!existsSync(file)) return;

  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;

    const key = trimmed.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;

    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

/**
 * S3's two time-windowed rows are scored against the process's LOCAL calendar
 * date, so an unpinned timezone silently moves the score by up to 40 points
 * (lib/policy/engine.ts, assertTimezonePinned). `loadPolicy` refuses to run
 * without it.
 *
 * Default it rather than fail on a developer laptop that has never set TZ —
 * this is a script, not the server — but only when it is UNSET. A TZ that is
 * set to the wrong zone is a deliberate statement and must still hit the
 * policy engine's error, which explains the problem far better than this
 * function could.
 */
function pinTimezone(): { pinned: boolean } {
  if (process.env.TZ === undefined || process.env.TZ.trim() === "") {
    process.env.TZ = "Asia/Kolkata";
    return { pinned: true };
  }
  return { pinned: false };
}

/* ── arguments ───────────────────────────────────────────────────────────── */

interface Args {
  set: SetName;
  /** Provider slug, or 'none' to run the deterministic pipeline with no model. */
  provider: string | null;
  limit: number | null;
  concurrency: number;
  /** Requests per minute ceiling. Free tiers are the normal case here. */
  rpm: number;
  force: boolean;
  out: string | null;
}

const USAGE = `
Usage: npm run eval -- --set <safety|dev|holdout> [options]

  --set <name>          Required. Which set to run.
  --provider <name>     ${PROVIDER_NAMES.join(" | ")} | none
                        Default: LLM_PROVIDER, or 'none' if that is unset.
                        'none' runs the deterministic pipeline with S2 null.
  --concurrency <n>     Parallel model calls. Default 2.
  --rpm <n>             Model requests per minute ceiling. Default 15.
  --limit <n>           Score only the first n items. For debugging.
  --out <path>          Also write the report to a file.
  --force               Allow a repeat holdout run. Read what it says first.
`.trim();

function parseArgs(argv: string[]): Args {
  const args: Args = {
    set: "dev",
    provider: null,
    limit: null,
    concurrency: 2,
    rpm: 15,
    force: false,
    out: null,
  };
  let sawSet = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} needs a value.\n\n${USAGE}`);
      return v;
    };

    switch (arg) {
      case "--set": {
        const name = value();
        if (!(SET_NAMES as readonly string[]).includes(name)) {
          throw new Error(`Unknown set "${name}". One of: ${SET_NAMES.join(", ")}.`);
        }
        args.set = name as SetName;
        sawSet = true;
        break;
      }
      case "--provider":
        args.provider = value();
        break;
      case "--limit":
        args.limit = Number(value());
        break;
      case "--concurrency":
        args.concurrency = Math.max(1, Number(value()));
        break;
      case "--rpm":
        args.rpm = Math.max(1, Number(value()));
        break;
      case "--out":
        args.out = value();
        break;
      case "--force":
        args.force = true;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument "${arg}".\n\n${USAGE}`);
    }
  }

  if (!sawSet) throw new Error(`--set is required.\n\n${USAGE}`);
  return args;
}

/* ── scoring one item ────────────────────────────────────────────────────── */

interface Outcome {
  item: EvalItem;
  assigned: Tier;
  matchedRule: string;
  composite: number;
  components: ComponentScores;
  z: number | null;
  changePoint: boolean;
  /** Pass 1 wall-clock. The interlock's budget is 50 ms (SAFETY_SPEC.md section 1). */
  interlockMs: number;
  /** Model wall-clock, or null when no call was made. */
  llmMs: number | null;
  llmSkipped: "lexicon_hit" | "no_transcript" | "no_provider" | null;
  llmFailed: string | null;
  pass2Rejection: string | null;
}

/**
 * One item, through the real pipeline, in the order of TM1_GUIDE.md section 7,
 * Prompt 9. Steps 1, 2 and 9 (validation, the consent gate, the database
 * writes) are route concerns and have no counterpart here.
 */
async function scoreItem(
  item: EvalItem,
  index: number,
  today: Date,
  policy: Policy,
  provider: LLMProvider | null,
  throttle: () => Promise<void>,
): Promise<Outcome> {
  const ctx = item.caseContext;

  const baseline = foldBaseline(ctx.priorComposites, (mean, variance, x) =>
    updateEWMA(mean, variance, x, policy.baseline.ewma_lambda),
  );
  const { person, caseRow, checkin } = materialise(item, index, today, baseline);

  /* Step 4 — Pass 1, before any model call. A hit is CRITICAL and the model is
     never consulted (SAFETY_SPEC.md section 2). */
  const t0 = performance.now();
  const pass1 = item.transcript === null ? { hit: false } : checkInput(item.transcript);
  let deterministic: DeterministicTrigger | null = pass1.hit
    ? { tier: "CRITICAL", source: "lexicon" }
    : null;

  /* SAFETY_SPEC.md section 3, fourth trigger: q3 answered "not safe" is
     CRITICAL on its own and does not go through the composite. It is read at
     scoring time, so unlike a lexicon hit it does NOT skip the model — which
     is what Prompt 9 specifies, and the eval mirrors the route rather than
     tidying it. */
  if (deterministic === null && q3IsCriticalTrigger(item.structured)) {
    deterministic = { tier: "CRITICAL", source: "self_report_q3" };
  }
  const interlockMs = performance.now() - t0;

  /* Steps 5 and 6 — the model, then Pass 2 on what it said. */
  let s2: number | null = null;
  let llmMs: number | null = null;
  let llmFailed: string | null = null;
  let pass2Rejection: string | null = null;
  let llmSkipped: Outcome["llmSkipped"] = null;

  if (pass1.hit) {
    llmSkipped = "lexicon_hit";
  } else if (item.transcript === null) {
    llmSkipped = "no_transcript";
  } else if (provider === null) {
    llmSkipped = "no_provider";
  } else {
    try {
      // Throttled here rather than per item: a lexicon hit or a missing
      // transcript never reaches the provider, and holding a rate-limit slot
      // for a call that is not made adds minutes to a run for nothing.
      await throttle();
      const call = await complete(SYSTEM_PROMPT, buildTurn(item.transcript), provider);
      s2 = call.output.s2_score;
      llmMs = call.ms;

      const pass2 = checkOutput(call.output.reply);
      if (pass2.rejected) {
        // The reply is discarded and replies.fallback_reply is sent instead.
        // The rejection count is a metric worth showing (SAFETY_SPEC.md
        // section 6). The s2_score survives: Pass 2 judges the text the person
        // would have read, not the number the counsellor sees.
        pass2Rejection = pass2.reason ?? "unknown";
      }
    } catch (error) {
      if (!(error instanceof LLMUnavailableError)) throw error;
      // The documented degradation: S2 null, everything else intact, the
      // check-in still scores on S1/S3/S4 (SAFETY_SPEC.md section 8, test S5).
      llmFailed = error.name;
    }
  }

  /* Step 7 — the five components, then the composite with renormalisation. */
  const s1 = scoreS1(item.structured);
  const s3 = scoreS3(caseRow, today);
  const s4 = scoreS4(person, checkin);
  // No audio reaches an eval item on either channel, so S5 is null. Its weight
  // is 0.00 either way and it changes neither the composite nor the
  // renormalisation denominator (SCORING_AND_POLICY.md section 2).
  const s5 = extractS5(null);

  const components: ComponentScores = {
    s1,
    s2,
    s3: s3.score,
    s4: s4.score,
    s5: s5.score,
  };
  const composite = computeComposite(components, compositeWeights(policy));

  /* Step 7, continued — z BEFORE the baseline update (the order bug in
     SCORING_AND_POLICY.md section 7). This harness never writes the update
     back: each item carries its own history in `priorComposites`. */
  const z = zScore(
    composite.composite,
    person.baseline_mean,
    person.baseline_var,
    policy.baseline.sigma_floor,
  );
  const changePoint = isChangePoint(
    z,
    ctx.priorComposites.length,
    policy.baseline.change_point_z,
    policy.baseline.min_history_for_change_point,
  );

  /* Step 8 — the tier. A deterministic trigger can only be raised. */
  const decision = assignTier(
    composite.composite,
    z,
    changePoint,
    s3.score,
    z === null,
    person.missed_count,
    policy,
    deterministic,
  );

  return {
    item,
    assigned: decision.tier,
    matchedRule: decision.matchedRule,
    composite: composite.composite,
    components,
    z,
    changePoint,
    interlockMs,
    llmMs,
    llmSkipped,
    llmFailed,
    pass2Rejection,
  };
}

/* ── running the set ─────────────────────────────────────────────────────── */

/**
 * A minimum interval between model calls, shared by every worker.
 *
 * Groq's free tier is 30 requests a minute and a token ceiling that binds
 * sooner than that (TM1_GUIDE.md section 2), and an 80-item set walks straight
 * into both. lib/llm/http.ts retries a 429 twice, but a set that spends its
 * retries on self-inflicted throttling reports latency for the retry loop
 * rather than for the provider. Pacing the calls is cheaper than measuring the
 * wrong thing.
 */
function rateLimiter(rpm: number): () => Promise<void> {
  const interval = 60_000 / rpm;
  let next = 0;

  return async () => {
    const now = Date.now();
    const at = Math.max(now, next);
    next = at + interval;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  };
}

async function runSet(
  items: EvalItem[],
  today: Date,
  policy: Policy,
  provider: LLMProvider | null,
  args: Args,
): Promise<Outcome[]> {
  const outcomes = new Array<Outcome>(items.length);
  const throttle = provider === null ? async () => {} : rateLimiter(args.rpm);
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      outcomes[i] = await scoreItem(items[i], i, today, policy, provider, throttle);
      done++;
      if (provider !== null && process.stderr.isTTY) {
        process.stderr.write(`\r  scoring ${done}/${items.length}`);
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(args.concurrency, items.length) },
    worker,
  );
  await Promise.all(workers);
  if (provider !== null && process.stderr.isTTY) {
    process.stderr.write("\r" + " ".repeat(40) + "\r");
  }

  return outcomes;
}

/* ── the report ──────────────────────────────────────────────────────────── */

const TIERS: readonly Tier[] = ["GREEN", "AMBER", "RED", "CRITICAL"];
const LANGS: readonly EvalLang[] = ["en", "hi", "hi-rom"];
const LANG_LABEL: Record<EvalLang, string> = {
  en: "English",
  hi: "Hindi (Devanagari)",
  "hi-rom": "Hindi (romanised)",
};

/** Severity order, for reporting which direction an error went. */
const SEVERITY: Record<Tier, number> = { GREEN: 0, AMBER: 1, RED: 2, CRITICAL: 3 };

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padLeft(s: string, width: number): string {
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function pct(numerator: number, denominator: number): string {
  if (denominator === 0) return "   n/a";
  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}

function recallLine(label: string, hit: number, total: number): string {
  return `  ${pad(label, 22)} ${padLeft(`${hit}/${total}`, 7)}   ${padLeft(pct(hit, total), 6)}`;
}

interface Report {
  text: string;
  criticalRecall: { hit: number; total: number };
  missed: Outcome[];
}

function buildReport(
  args: Args,
  items: EvalItem[],
  outcomes: Outcome[],
  policy: Policy,
  provider: LLMProvider | null,
  today: Date,
): Report {
  const out: string[] = [];
  const say = (line = "") => out.push(line);

  /* ── header ── */
  say(`Eval set: ${args.set}   (${outcomes.length} items)`);
  say(`Run date: ${today.toISOString()}   TZ=${process.env.TZ}`);
  say(`Policy:   ${policy.version}, signed by ${policy.signed_by}`);
  say(`Lexicon:  ${LEXICON_VERSION}`);
  say(
    `Model:    ${provider === null ? "none — no model called, S2 is null on every item" : modelVersion(provider)}`,
  );
  say();

  /* ── confusion matrix ── */
  const confusion = new Map<string, number>();
  for (const o of outcomes) {
    const key = `${o.item.expectedTier}>${o.assigned}`;
    confusion.set(key, (confusion.get(key) ?? 0) + 1);
  }

  say("Confusion matrix — rows: expected, columns: assigned");
  say(`  ${pad("", 10)}${TIERS.map((t) => padLeft(t, 10)).join("")}${padLeft("total", 10)}`);
  for (const expected of TIERS) {
    const cells = TIERS.map((assigned) =>
      padLeft(String(confusion.get(`${expected}>${assigned}`) ?? 0), 10),
    );
    const total = outcomes.filter((o) => o.item.expectedTier === expected).length;
    say(`  ${pad(expected, 10)}${cells.join("")}${padLeft(String(total), 10)}`);
  }
  say();

  /*
   * Which way the disagreements went. Not a correctness rate: the two
   * directions are not interchangeable and must never be added together. An
   * under-call is a person who needed a counsellor and did not get one; an
   * over-call is a counsellor reading one extra transcript. In a crisis system
   * over-firing is the correct failure direction (SAFETY_SPEC.md section 4).
   */
  const under = outcomes.filter(
    (o) => SEVERITY[o.assigned] < SEVERITY[o.item.expectedTier],
  );
  const over = outcomes.filter(
    (o) => SEVERITY[o.assigned] > SEVERITY[o.item.expectedTier],
  );
  say(`  Under-called (assigned below expected): ${under.length}   <- the ones that matter`);
  say(`  Over-called  (assigned above expected): ${over.length}`);
  say();

  /*
   * Every disagreement, itemised. SCORING_AND_POLICY.md section 10 step 3 is
   * "adjust the YAML, bump the version, re-run", and a matrix that reports
   * three over-calls without naming them is not something anyone can tune
   * against. The matched rule and the component breakdown are what say WHICH
   * threshold moved the item, and CLAUDE.md rule 8 forbids showing a composite
   * without its breakdown in any case.
   */
  const disagreements = [...under, ...over].sort((a, b) =>
    a.item.id.localeCompare(b.item.id),
  );
  if (disagreements.length > 0) {
    say("Disagreements, expected -> assigned");
    for (const o of disagreements) {
      const c = o.components;
      const num = (v: number | null) => (v === null ? "null" : String(Math.round(v * 100) / 100));
      say(
        `  ${pad(o.item.id, 8)}${pad(`[${o.item.lang}]`, 9)}${pad(`${o.item.expectedTier} -> ${o.assigned}`, 20)}via '${o.matchedRule}'`,
      );
      say(
        `    composite ${num(o.composite)}  S1 ${num(c.s1)}  S2 ${num(c.s2)}  S3 ${num(c.s3)}  S4 ${num(c.s4)}  z ${num(o.z)}  changePoint ${o.changePoint}`,
      );
    }
    say();
  }

  /* ── recall on CRITICAL, overall and per language ── */
  const criticals = outcomes.filter((o) => o.item.expectedTier === "CRITICAL");
  const detected = criticals.filter((o) => o.assigned === "CRITICAL");
  const missed = criticals.filter((o) => o.assigned !== "CRITICAL");

  say("Recall on CRITICAL");
  say(recallLine("overall", detected.length, criticals.length));
  say();

  /*
   * Per language, as SEPARATE rows and never averaged (SAFETY_SPEC.md section
   * 8). Romanised Hindi is its own row because it is its own matching problem
   * to a regular expression, and it is the form that gets forgotten.
   */
  say("Recall on CRITICAL, per language");
  for (const lang of LANGS) {
    const inLang = criticals.filter((o) => o.item.lang === lang);
    say(recallLine(LANG_LABEL[lang], inLang.filter((o) => o.assigned === "CRITICAL").length, inLang.length));
  }
  say();

  /*
   * The other half of SAFETY_SPEC.md section 8: the over-fire rate on items
   * that are not meant to be CRITICAL. It is "recorded, not required to be
   * zero" — the lexicon fires on "help me" and on "this paperwork is killing
   * me" knowingly, and the correct response is to state the rate rather than
   * to add negation handling.
   */
  const nonCritical = outcomes.filter((o) => o.item.expectedTier !== "CRITICAL");
  const overFired = nonCritical.filter((o) => o.assigned === "CRITICAL");
  say("CRITICAL raised on items not expected to be critical, per language");
  for (const lang of LANGS) {
    const inLang = nonCritical.filter((o) => o.item.lang === lang);
    say(
      recallLine(
        LANG_LABEL[lang],
        inLang.filter((o) => o.assigned === "CRITICAL").length,
        inLang.length,
      ),
    );
  }
  say(recallLine("all languages", overFired.length, nonCritical.length));
  if (overFired.length > 0) {
    say("  Over-firing is the intended failure direction here, not a defect to tune away.");
  }
  say();

  /* ── Pass 2 ── */
  const rejections = outcomes.filter((o) => o.pass2Rejection !== null);
  const called = outcomes.filter((o) => o.llmMs !== null);
  say("Pass-2 interlock (model replies discarded before anyone read them)");
  say(`  rejections: ${rejections.length} of ${called.length} model replies`);
  const byReason = new Map<string, number>();
  for (const o of rejections) {
    byReason.set(o.pass2Rejection as string, (byReason.get(o.pass2Rejection as string) ?? 0) + 1);
  }
  for (const [reason, count] of [...byReason].sort((a, b) => b[1] - a[1])) {
    say(`    ${pad(reason, 20)} ${count}`);
  }
  say();

  /* ── latency ── */
  const mean = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
  const llmTimes = called.map((o) => o.llmMs as number);
  const meanLlm = mean(llmTimes);
  const meanInterlock = mean(outcomes.map((o) => o.interlockMs));

  say("Latency");
  say(
    `  mean model call:  ${meanLlm === null ? "n/a — no model was called" : `${meanLlm.toFixed(0)} ms over ${llmTimes.length} calls`}`,
  );
  if (meanLlm !== null) {
    const sorted = [...llmTimes].sort((a, b) => a - b);
    say(`  median / max:     ${sorted[Math.floor(sorted.length / 2)].toFixed(0)} ms / ${sorted[sorted.length - 1].toFixed(0)} ms`);
  }
  say(
    `  mean Pass-1 interlock: ${(meanInterlock ?? 0).toFixed(2)} ms   (budget 50 ms, SAFETY_SPEC.md section 1)`,
  );
  say();

  /* ── how much of the set was scored without a model ── */
  const skipped = {
    lexicon_hit: outcomes.filter((o) => o.llmSkipped === "lexicon_hit").length,
    no_transcript: outcomes.filter((o) => o.llmSkipped === "no_transcript").length,
    no_provider: outcomes.filter((o) => o.llmSkipped === "no_provider").length,
  };
  const failed = outcomes.filter((o) => o.llmFailed !== null);
  const s2Null = outcomes.filter((o) => o.components.s2 === null);

  say("S2 coverage");
  say(`  scored with a model reply:      ${called.length}`);
  say(`  S2 null, weights renormalised:  ${s2Null.length}`);
  say(`    lexicon hit, model skipped:   ${skipped.lexicon_hit}`);
  say(`    no transcript on the item:    ${skipped.no_transcript}`);
  say(`    no provider configured:       ${skipped.no_provider}`);
  say(`    provider call failed:         ${failed.length}`);
  if (failed.length > 0) {
    say("  A missing S2 is renormalised over the remaining weights, never read as 0,");
    say("  which RAISES the composite (SCORING_AND_POLICY.md section 4).");
  }
  say();

  /* ── the misses, in full ── */
  if (missed.length > 0) {
    say("MISSED CRITICAL ITEMS — every one of these is a build blocker");
    for (const o of missed) {
      say(`  ${o.item.id} [${o.item.lang}] assigned ${o.assigned} via '${o.matchedRule}'`);
      say(`    transcript: ${o.item.transcript ?? "(none)"}`);
      say(`    expected a lexicon match in lib/safety/lexicon.ts, or q3 = 4.`);
      say(`    notes: ${o.item.notes}`);
    }
    say();
  }

  return {
    text: out.join("\n"),
    criticalRecall: { hit: detected.length, total: criticals.length },
    missed,
  };
}

/* ── the holdout guard ───────────────────────────────────────────────────── */

const RESULTS_DIR = "evals/results";

/**
 * SCORING_AND_POLICY.md section 10, step 4: the holdout is run "exactly once,
 * on Day 4". CHECKS_TM1.md T1-E2 is a BLOCKER on there being exactly one
 * holdout result file, because two means it was run repeatedly, which means it
 * was tuned against, which means the number is worthless.
 *
 * So the guard is structural rather than a note in a document. `--force`
 * exists, prints what it is doing, and leaves both files on disk — if the
 * holdout has to be re-run, that fact should be visible in the repository
 * rather than resolved quietly.
 */
function existingHoldoutResults(): string[] {
  if (!existsSync(RESULTS_DIR)) return [];
  return readdirSync(RESULTS_DIR).filter((f) => f.includes("holdout"));
}

function writeResult(name: string, body: string): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const file = path.join(RESULTS_DIR, name);
  writeFileSync(file, body, "utf8");
  return file;
}

/* ── main ────────────────────────────────────────────────────────────────── */

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  loadDotEnv(path.join(process.cwd(), ".env.local"));
  const tz = pinTimezone();

  const policy = loadPolicy();
  const today = new Date();

  const file = `evals/${args.set}.jsonl`;
  if (!existsSync(file)) throw new Error(`${file} does not exist.`);
  let items = parseJsonl(readFileSync(file, "utf8"), file);

  if (items.length < MIN_SET_SIZE[args.set]) {
    throw new Error(
      `${file} holds ${items.length} items; CHECKS_TM1.md T1-E5 requires at least ${MIN_SET_SIZE[args.set]}.`,
    );
  }

  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`${file}: duplicate persona id ${item.id}.`);
    ids.add(item.id);
  }

  if (args.limit !== null) items = items.slice(0, args.limit);

  /* The holdout guard runs BEFORE the set is scored, so a second run costs
     nothing and fails immediately. */
  if (args.set === "holdout" && !args.force) {
    const existing = existingHoldoutResults();
    if (existing.length > 0) {
      console.error(
        [
          `The holdout has already been run: ${existing.map((f) => path.join(RESULTS_DIR, f)).join(", ")}`,
          "",
          "SCORING_AND_POLICY.md section 10 runs this set exactly once, on Day 4, and",
          "reports whatever it says. A held-out number you have already seen and tuned",
          "against is not a held-out number, and you will know that while you are",
          "standing in front of the judges.",
          "",
          "Use --force only if you accept that the second file is part of the record.",
        ].join("\n"),
      );
      return 1;
    }
  }

  /* Provider resolution. 'none' is a first-class mode, not a fallback: the
     safety set never needs a model — crisis detection is deterministic code
     (CLAUDE.md rule 1) — and CI runs it with no key configured. */
  const requested = (args.provider ?? process.env.LLM_PROVIDER ?? "none").trim().toLowerCase();
  let provider: LLMProvider | null = null;
  if (requested !== "none" && requested !== "") {
    // A misspelled provider still throws (UnknownProviderError). That is a
    // deployment mistake, not a runtime condition, and it must be noisy.
    provider = getProvider(requested);

    if (!process.env.LLM_API_KEY && provider.name !== "ollama") {
      /*
       * Degrade rather than fail. The safety gate must NEVER depend on whether
       * a model is reachable — crisis detection is deterministic code
       * (CLAUDE.md rule 1) and SAFETY_SPEC.md section 8 test S5 requires the
       * whole pipeline to keep working with the provider unavailable. Exiting
       * non-zero here would let an unrelated missing secret block the one
       * check in this repository that must not be blocked.
       *
       * It is loud, and it cannot be misread afterwards: the report header
       * says the model was 'none' and the S2 coverage section counts every
       * item that was scored without one.
       */
      console.error(
        `warning: LLM_API_KEY is not set, so provider "${requested}" cannot be called.\n` +
          "         Continuing with no model: S2 is null on every item and the\n" +
          "         weights renormalise over the remaining components.\n" +
          (args.set === "safety"
            ? "         The safety set does not need a model — this does not weaken the gate.\n"
            : "         Tier labels in this set assume a live S2; read the matrix with that in mind.\n"),
      );
      provider = null;
    }
  }

  if (tz.pinned) {
    console.error("note: TZ was unset; pinned to Asia/Kolkata for this run.\n");
  }

  const outcomes = await runSet(items, today, policy, provider, args);
  const report = buildReport(args, items, outcomes, policy, provider, today);

  console.log(report.text);

  /* ── the gate ── */
  if (args.set === "safety") {
    const { hit, total } = report.criticalRecall;
    if (hit < total) {
      console.log(
        `SAFETY SET FAILED: ${total - hit} of ${total} critical utterances were not detected.\n` +
          "This is a build blocker, not a warning (SAFETY_SPEC.md section 8, test S1).\n" +
          "Fix lib/safety/lexicon.ts. Never edit evals/safety.jsonl to make this pass.",
      );
      return 1;
    }
    console.log(
      `SAFETY SET PASSED: ${hit}/${total} critical utterances detected, all three written forms.`,
    );
  }

  if (args.set === "holdout") {
    const stamp = new Date().toISOString().slice(0, 10);
    const written = writeResult(
      `holdout-${stamp}.md`,
      `# Holdout result — ${stamp}\n\nRun once, per SCORING_AND_POLICY.md section 10.\nDo not tune after reading this.\n\n\`\`\`\n${report.text}\n\`\`\`\n`,
    );
    console.log(`\nWritten to ${written}. Do not tune after reading it.`);
  }

  if (args.out !== null) {
    writeFileSync(args.out, report.text, "utf8");
    console.log(`\nWritten to ${args.out}`);
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
