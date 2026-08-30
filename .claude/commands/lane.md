---
description: Flag changed files outside the current author's CODEOWNERS paths.
allowed-tools: Bash(git diff:*), Bash(git status:*), Bash(git config:*), Bash(git log:*), Read
---

Check that this branch stayed in its lane. `CLAUDE.md` is explicit: *"If a
change requires touching another owner's directory, say so and stop. Do not
refactor across these lines for consistency."*

## 1. Changed files

```
git diff --name-only main...HEAD
```

If `main` does not exist or the repo has no commits, fall back to
`git status --porcelain` and say which you used.

## 2. Who is the author

Use `git config user.name` / `user.email`, or the most recent commit author.
Map them to `@tm1` / `@tm2` / `@tm3`. **If you cannot map the author with
confidence, ask which lane they are in — do not guess**, since guessing wrong
inverts the whole report.

## 3. Match against CODEOWNERS

Read `.github/CODEOWNERS`. Apply the patterns the way git does: **last matching
pattern wins** — which is why `/types/contract.ts` sits at the bottom.

Note that `scripts/` is deliberately split: `fixtures.ts`, `fixtures.test.ts`
and `run-tests.mjs` are TM1's; `seed.ts` is TM3's.

## 4. Report

```
IN LANE      <file>
OUT OF LANE  <file>   owner: <@tmN>   author: <@tmM>
UNOWNED      <file>   no CODEOWNERS pattern matches
```

Call out three cases specifically:

- **`types/contract.ts`** — FROZEN. Any change needs TM1 sign-off and a note in
  the PR description. Flag it loudly even if the author *is* TM1.
- **Cross-lane refactors** — a file touched only for formatting, renaming, or
  "consistency" outside the author's paths. That is the exact thing the
  ownership table forbids.
- **UNOWNED files** — a path no pattern covers. This is a gap in CODEOWNERS,
  not permission to edit; name it so it can be assigned.

End with a one-line verdict: **IN LANE** or **CROSSES N LANES**. If anything is
out of lane, state which owner needs to be messaged before merge.
