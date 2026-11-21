---
name: PR Review Context
description: Establish a pull request's intent, scope and affected flow before reviewing its code
---

# PR Review Context

Load this first. Reviewing lines without the intent produces confident noise.
The sources are `pr-review-guidelines.md` §1–3, `real-work-guidlines.md` and
`plan-guidlines.md`.

## Read

- `.review/pr/metadata.json` — title, body, author, base/head, changed paths.
- `.review/pr/diff.patch` — the actual change.
- The changed files and their tests under `.review/pr/files/`, located through
  `metadata.files[].dataFile` and read by their neutral copy names.
- The repository rules that name the affected area: `CLAUDE.md`,
  `.code-rules.md`, `CLEAN_CODE.md` and the relevant `docs/` page.
- The guidelines manifest entries mapped to `pr-review-context`.

## Answer

1. What problem does the PR solve, and for whom?
2. What is the expected behaviour before and after?
3. Which component, phase, bank pipeline or public surface changes?
4. Is the change type clear: feature, fix, refactor, test, docs, CI or
   dependency?
5. Does the diff match the stated scope? Name scope creep and missing pieces.
6. Which tests, docs, migrations, feature flags or rollbacks must move with it?
7. Is there a dependency on another service, workflow, credential or team?

## Findings this skill may raise

- The PR cannot achieve its stated goal with this diff.
- The diff includes an unrelated change or leaves the stated change partial.
- A changed public behaviour has no docs or migration.
- A risky change has no rollout, feature flag or rollback.
- The PR body or commit messages are too vague to review safely.

Do not raise a finding for a missing nice-to-have that the repository does not
require. Put open questions in the summary if they do not block the change.

## Handoff

Write a short context paragraph for the summary and pass the changed-flow map
to the code and architecture skills. If the diff is empty or the intent cannot
be established, stop and return `NEEDS CONTEXT`.
