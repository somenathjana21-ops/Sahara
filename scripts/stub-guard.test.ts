/**
 * scripts/stub-guard.test.ts — the stub must fail closed.
 *
 * Owner: TM1. Guards docs/CHECKS_TM1.md check T1-B0.
 *
 * The stub routes answer every check-in with a fixed GREEN. Deployed without a
 * guard, that is a public URL telling a person in crisis that they are fine.
 * These tests assert the refusal path is a real 503 carrying real helpline
 * numbers, so that "the safety layer is missing" degrades to "call 14566"
 * rather than to "how is your sleep?".
 *
 * Deleted alongside lib/safety/stub-guard.ts when the interlock lands.
 */

import { strict as assert } from "node:assert";
import test from "node:test";

import {
  STATIC_CRISIS_RESOURCES,
  STUB_MODE,
  stubUnavailable,
} from "@/lib/safety/stub-guard";

test("stubUnavailable() returns 503, not 200", async () => {
  const response = stubUnavailable();
  assert.equal(
    response.status,
    503,
    "an unimplemented pipeline is an unavailable service, not a successful one",
  );
});

test("the body carries both helpline numbers", async () => {
  const body = await stubUnavailable().json();
  const text = JSON.stringify(body);

  assert.ok(
    text.includes("14566"),
    "National Helpline Against Atrocities (14566) is missing from the refusal body",
  );
  assert.ok(
    text.includes("14416"),
    "Tele-MANAS (14416) is missing from the refusal body",
  );
});

test("the numbers are reachable as structured resources, not just prose", async () => {
  const body = (await stubUnavailable().json()) as {
    error: string;
    resources: { label: string; phone: string }[];
  };

  assert.equal(body.error, "pipeline_not_implemented");
  assert.deepEqual(
    body.resources.map((r) => r.phone).sort(),
    ["14416", "14566"],
  );
  for (const resource of body.resources) {
    assert.ok(resource.label.length > 0, `${resource.phone} has no label`);
  }
});

test("the refusal never carries a tier", async () => {
  const body = (await stubUnavailable().json()) as Record<string, unknown>;

  assert.equal(
    body.tier,
    undefined,
    "a route with no safety layer must not emit a tier of any kind",
  );
  assert.equal(body.reply, undefined);
  assert.equal(body.assessmentId, undefined);
});

test("the resource list is hardcoded, not derived from an absent safety layer", () => {
  // lib/safety/replies.ts does not exist yet. If this list ever starts coming
  // from there, the one thing guaranteed to reach a person becomes dependent on
  // the very layer whose absence this guard exists to survive.
  assert.equal(STATIC_CRISIS_RESOURCES.length, 2);
});

test("STUB_MODE is off unless the env var is exactly '1'", { skip: process.env.STUB_MODE === "1" ? "STUB_MODE=1 is set in this shell" : false }, () => {
  assert.equal(
    STUB_MODE,
    false,
    "the default must be to refuse — a missing or misspelled STUB_MODE has to land on the safe side",
  );
});
