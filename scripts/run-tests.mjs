// scripts/run-tests.mjs — the whole test harness.
//
// `npm run test`            runs every *.test.ts in the repo.
// `npm run test -- scoring` runs only the ones whose path contains "scoring",
//                           which is the calling convention CHECKS_TM1.md and
//                           CHECKS_TM3.md already assume.
//
// Node's built-in test runner does the work; tsx resolves TypeScript and the
// "@/" path alias from tsconfig.json. No test framework dependency.

import { spawnSync } from "node:child_process";
import { globSync } from "node:fs";

const filters = process.argv.slice(2);

const all = globSync("**/*.test.ts", {
  exclude: (p) => p.includes("node_modules") || p.includes(".next"),
});

const files = filters.length
  ? all.filter((f) => filters.some((s) => f.includes(s)))
  : all;

if (files.length === 0) {
  const suffix = filters.length ? `: ${filters.join(", ")}` : "";
  console.error(`No test files matched${suffix}.`);
  process.exit(1);
}

// Two variables, two different jobs.
//
// PROJECT_TZ is what lib/policy/engine.ts checks: it refuses to load a policy
// unless the environment has declared which calendar the case dates are on (see
// assertTimezonePinned there). It is not called TZ because Vercel reserves that
// name and will not let it be created in production.
//
// TZ is the process zone, and the harness still pins it: the scoring tests hand
// scoreS3 explicit IST instants and assert what the LOCAL calendar fields make
// of them. A developer in another zone must get the same numbers as the demo
// laptop.
const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  {
    stdio: "inherit",
    env: { ...process.env, TZ: "Asia/Kolkata", PROJECT_TZ: "Asia/Kolkata" },
  },
);

process.exit(result.status ?? 1);
