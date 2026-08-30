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

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", ...files],
  { stdio: "inherit" },
);

process.exit(result.status ?? 1);
