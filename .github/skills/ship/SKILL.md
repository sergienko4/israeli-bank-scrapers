---
name: ship
description: SHIP phase. Use to land a verified change — atomic Conventional Commit through all husky gates (never --no-verify, never git add .), PR body with Why/What/Guideline-compliance validated by lint:pr-body, then gh pr create and monitor. Faster is safer.
---

# /ship — Ship to production (SHIP)

**Principle:** Faster is safer — small, verified changes, shipped often.

Land the change as one atomic, reviewable unit through every gate. No
shortcuts.

## Do

1. **Stage selectively** — name each file; never `git add .`.
2. **Commit** with a Conventional Commit (`fix|feat|refactor|chore(scope):`),
   subject ≤ ~50 chars, body wrapped ≤72, and the trailer
   `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
   All 21 husky pre-commit gates must pass — **never `--no-verify`**, never
   weaken a gate to get green.
3. **PR body** → write `.git/PR_BODY.md` with `## Why`, `## What`, and the
   `## Guideline compliance` table; validate with
   `npm run lint:pr-body -- --file .git/PR_BODY.md` before creating the PR.
4. **Open** with `gh pr create --body-file .git/PR_BODY.md`, then **monitor**
   CI + CodeRabbit until merge (don't merge yourself; address findings through
   the full gate chain).
5. Release is automated via release-please from the commit message.

## Defer to (canonical, do not restate)

- `C:\tmp\guidelines\before-commit-guidlines.md`, `commit-guidlines.md`,
  `pr-guidlines.md`, `post-pr-checklist.md`
- In-repo: `.husky/` gates, [`CLAUDE.md`](../../../CLAUDE.md) §Pre-Commit /
  Pre-Push protocols.

## Exit gate

PR open, all blocking checks green, findings resolved, merged.
